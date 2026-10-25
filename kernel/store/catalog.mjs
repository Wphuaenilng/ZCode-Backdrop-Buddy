export const BUILTIN_CATALOG = [
  { id: 'sakura', name: '樱花黎明', tags: ['风景', '艺术'], accent: '#C98F8F' },
  { id: 'moon', name: '月光花园', tags: ['风景'], accent: '#6F9275' },
  { id: 'forest', name: '森林薄雾', tags: ['风景'], accent: '#6F9275' },
  { id: 'mountain', name: '山麓晨光', tags: ['风景'], accent: '#B98A63' },
  { id: 'bamboo', name: '竹林听雨', tags: ['风景'], accent: '#7FAE8A' },
  { id: 'cyber', name: '赛博霓虹', tags: ['城市', '科技', '动态'], accent: '#B97BE6' },
  { id: 'hologram', name: '全息都市', tags: ['城市', '科技'], accent: '#6FA8D8' },
  { id: 'circuit', name: '霓虹电路', tags: ['科技', '动态'], accent: '#4EC9E6' },
  { id: 'synthwave', name: '合成波网格', tags: ['科技', '艺术', '动态'], accent: '#E47BB0' },
  { id: 'paper', name: '纸上微光', tags: ['艺术'], accent: '#8E8978' },
  { id: 'geometry', name: '柔和几何', tags: ['艺术'], accent: '#C08F87' },
  { id: 'mono', name: '单色线条', tags: ['艺术'], accent: '#B7B7B7' },
  { id: 'aurora', name: '午夜极光', tags: ['风景', '动态'], accent: '#5ED1A6' },
  { id: 'dark', name: '黑暗微光', tags: ['科技', '艺术'], accent: '#5C8C88' },
  { id: 'stars', name: '静谧星海', tags: ['风景', '动态'], accent: '#7E9ED8' },
  { id: 'rain', name: '雨夜窗景', tags: ['城市', '艺术'], accent: '#D9A06A' },
  { id: 'amber', name: '琥珀黄昏', tags: ['风景', '艺术'], accent: '#C98A55' },
  { id: 'peach', name: '蜜桃日出', tags: ['风景'], accent: '#D98F87' },
  { id: 'candle', name: '烛光工坊', tags: ['艺术'], accent: '#C98A45' },
  { id: 'autumn', name: '秋日窗边', tags: ['风景', '艺术'], accent: '#B97B4E' }
];

export const BUILTIN_IDS = new Set(BUILTIN_CATALOG.map((theme) => theme.id));

export function isBuiltinId(id) {
  return BUILTIN_IDS.has(id);
}

export const LOCAL_ASSET_THEMES = [
  {
    id: 'local-original',
    name: '原图素材',
    tags: ['风景', '艺术'],
    file: 'original.jpg',
    kind: 'image',
    params: { accent: '#C6A15B' }
  },
  {
    id: 'local-video',
    name: '原视频素材',
    tags: ['动态', '城市'],
    file: 'original.mp4',
    kind: 'video',
    params: { accent: '#7E9ED8' }
  },
  {
    id: 'local-test',
    name: '测试233',
    tags: ['艺术'],
    file: '测试233.jpg',
    kind: 'image',
    params: { accent: '#D8A0A8' }
  }
];
