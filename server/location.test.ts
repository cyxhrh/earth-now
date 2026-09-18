import { describe, expect, it } from 'vitest'
import { locateArticle, locateTitle } from './location'

describe('hierarchical news locations', () => {
  it('does not mistake the war mentioned as background for the country holding a vote', () => {
    expect(
      locateArticle('Russians go to polls against backdrop of Ukraine war').location?.name,
    ).toBe('俄罗斯')
  })
  it('separates the event venue from the reporting institution and nationality', () => {
    expect(locateArticle('英国海上贸易行动办公室：一油轮在霍尔木兹海峡遇袭').location?.name).toBe(
      '霍尔木兹海峡',
    )
    expect(locateArticle('英国海上贸易行动办公室：一油轮在未知海峡遇袭').location).toBeNull()
    expect(
      locateArticle('海口综保区与白俄罗斯格罗德诺经济区签约 搭建跨境合作平台').location?.name,
    ).not.toBe('俄罗斯')
    expect(locateTitle('白俄罗斯公布经济数据')?.name).toBe('白俄罗斯')
    expect(locateArticle('德国选手夺得网球冠军').location).toBeNull()
    expect(locateArticle('马来西亚华人昆明街头路遇外公').location?.name).toContain('昆明')
    expect(
      locateArticle('英国机构发布通报', '该机构收到一起发生在霍尔木兹海峡的事件报告。').location
        ?.name,
    ).toBe('霍尔木兹海峡')
    expect(locateArticle('英国专家在柏林大学研究人工智能').location).toBeNull()
    expect(locateArticle('某大学在重庆举行学术会议').location?.name).toBe('重庆，中国')
  })
  it('recognizes more Oceanian and American locations without inventing cities for national news', () => {
    expect(locateTitle('美国纽约州北部发生洪水')).toMatchObject({
      name: '美国',
      precision: 'country',
    })
    expect(locateTitle('纽约州宣布进入紧急状态')).toBeNull()
    expect(locateTitle('澳大利亚墨尔本举行科技展')).toMatchObject({
      name: '墨尔本，澳大利亚',
      precision: 'city',
    })
    expect(locateTitle('厄瓜多尔总统宣布新举措')).toMatchObject({
      name: '厄瓜多尔',
      precision: 'country',
    })
    expect(locateTitle('新西兰奥克兰举行庆典')).toMatchObject({ name: '奥克兰，新西兰' })
    expect(locateTitle('美国纽约举办文化展')).toMatchObject({ name: '纽约，美国' })
    expect(locateTitle('美国发布新政策')).toMatchObject({ name: '美国', precision: 'country' })
  })
  it('uses a uniquely explicit event venue even in a title naming two countries', () => {
    expect(locateArticle('广州与悉尼结好40周年庆祝活动在悉尼举行').location?.name).toBe(
      '悉尼，新南威尔士州，澳大利亚',
    )
    expect(locateArticle('中巴文化活动在巴西里约热内卢举行').location?.name).toBe(
      '里约热内卢，巴西',
    )
    expect(locateArticle('广州与悉尼深化合作').location).toBeNull()
    expect(locateArticle('中国和澳大利亚会谈', '记者在悉尼报道。').location).toBeNull()
    expect(locateTitle('Perth and Melbourne updates')).toBeNull()
  })
  it('maps an explicit province or state instead of a country centroid', () => {
    expect(locateTitle('Flood warnings in Sichuan, China')).toMatchObject({
      name: '四川省，中国',
      precision: 'region',
    })
    expect(locateTitle('广东省启动防汛响应')).toMatchObject({
      name: '广东省，中国',
      precision: 'region',
    })
    expect(locateTitle('Runaway horse found in New Mexico')).toMatchObject({
      name: '新墨西哥州，美国',
      precision: 'region',
    })
  })
  it('resolves nested city, province and country to one place', () => {
    expect(locateTitle('South African president visits Johannesburg')).toMatchObject({
      name: '约翰内斯堡，豪登省，南非',
      precision: 'city',
    })
    expect(locateTitle('California fire near Los Angeles, US')).toMatchObject({
      name: '洛杉矶，加利福尼亚州，美国',
      precision: 'city',
    })
    expect(locateTitle('Saudi Arabia says it shot down drone south of Mecca')).toMatchObject({
      name: '麦加，麦加省，沙特阿拉伯',
      precision: 'city',
    })
  })
  it('accepts explicit local summary context and records the evidence', () => {
    expect(
      locateArticle('A runaway horse was captured', 'It escaped before a parade in New Mexico.'),
    ).toMatchObject({ location: { precision: 'region', name: '新墨西哥州，美国' } })
    expect(
      locateArticle(
        'NASA astronauts visit assembly building',
        'The building is at the Kennedy Space Center in Florida.',
      ).locationBasis,
    ).toContain('摘要')
    expect(
      locateArticle('Mars discoveries', 'Written by a professor at University of Tokyo.').location,
    ).toBeNull()
  })
  it('does not invent a state for national news or resolve ambiguous names', () => {
    expect(locateTitle('Eight German state premiers back Merz')).toMatchObject({
      name: '德国',
      precision: 'country',
    })
    expect(locateTitle('Georgia officials meet in Washington')).toBeNull()
    expect(locateTitle('Officials tell us about LA')).toBeNull()
    expect(locateTitle('China and California sign agreement')).toBeNull()
    expect(locateTitle('Berlin and Tokyo hold talks')).toBeNull()
    expect(locateArticle('Iran and Israel hold talks', 'A summit in Berlin.').location).toBeNull()
    expect(locateArticle('Germany relief update', 'A reporter in Tokyo.').location?.name).toBe(
      '德国',
    )
  })
})
