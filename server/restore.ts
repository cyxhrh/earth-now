import './environment'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { dataDir } from './store'
import { NewsDatabase, openDatabase } from './database'
import { NewsPipeline } from './pipeline'

const file = process.argv[2]
if (!file) throw Error('用法：npm run news:restore -- <备份文件>；目标必须是空数据库。')
const backup = z
  .object({
    schema: z.literal(1),
    tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    translations: z.record(z.string(), z.unknown()),
    briefs: z.record(z.string(), z.unknown()),
  })
  .parse(JSON.parse(await readFile(file, 'utf8')))
const columns = {
  articles: [
    'id',
    'source_url',
    'channel',
    'publication_day',
    'published_at',
    'first_seen',
    'last_seen',
    'version',
    'payload',
  ],
  article_versions: ['article_id', 'version', 'payload', 'observed_at'],
  tasks: ['id', 'article_id', 'version', 'kind', 'status', 'attempts', 'due_at', 'error'],
  runtime_state: ['key', 'value'],
  daily_usage: ['day', 'attempts'],
}
const db = await openDatabase(dataDir)
try {
  const database = new NewsDatabase(db)
  await database.init()
  for (const table of Object.keys(columns)) {
    if ((await db.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length)
      throw Error('恢复被拒绝：目标数据库不是空库。请使用新的 NEWS_DATA_DIR 或 PostgreSQL 数据库。')
    if (!backup.tables[table]) throw Error('备份缺少必要数据表。')
  }
  await db.query('BEGIN')
  try {
    for (const [table, fields] of Object.entries(columns)) {
      for (const row of backup.tables[table]) {
        await db.query(
          `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})`,
          fields.map((field) =>
            ['payload', 'value'].includes(field) ? JSON.stringify(row[field]) : row[field],
          ),
        )
      }
    }
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
  await writeFile(
    join(dataDir, 'translations.zh-CN.json'),
    JSON.stringify(backup.translations),
    'utf8',
  )
  await writeFile(join(dataDir, 'briefs.zh-CN.json'), JSON.stringify(backup.briefs), 'utf8')
  await new NewsPipeline(database, dataDir).publish()
  console.log('已恢复到空数据库并发布快照；未调用新闻来源或模型。')
} finally {
  await db.close()
}
