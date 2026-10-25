// 内置占位配色已移除：随包壁纸全部来自 LOCAL_ASSET_THEMES（真实图片/视频素材）。
export const BUILTIN_CATALOG = [];

export const BUILTIN_IDS = new Set(BUILTIN_CATALOG.map((theme) => theme.id));

export function isBuiltinId(id) {
  return BUILTIN_IDS.has(id);
}

export const LOCAL_ASSET_THEMES = [
  {
    id: 'romantic-rose',
    name: '浪漫玫瑰',
    tags: ['风景'],
    file: 'romantic-rose.jpg',
    kind: 'image',
    params: { accent: '#A6536A' }
  },
  {
    id: 'sakura-dawn',
    name: '樱花黎明',
    tags: ['风景'],
    file: 'sakura-dawn.jpg',
    kind: 'image',
    params: { accent: '#D9879D' }
  },
  {
    id: 'cloud-reverie',
    name: '云端遐想',
    tags: ['风景'],
    file: 'cloud-reverie.jpg',
    kind: 'image',
    params: { accent: '#7B78D6' }
  },
  {
    id: 'moonlit-garden',
    name: '月光花园',
    tags: ['风景'],
    file: 'moonlit-garden.jpg',
    kind: 'image',
    params: { accent: '#7286D9' }
  },
  {
    id: 'forest-mist',
    name: '森林薄雾',
    tags: ['风景'],
    file: 'forest-mist.jpg',
    kind: 'image',
    params: { accent: '#6F9275' }
  },
  {
    id: 'alpine-dawn',
    name: '山巅晨光',
    tags: ['风景'],
    file: 'alpine-dawn.jpg',
    kind: 'image',
    params: { accent: '#7191A8' }
  },
  {
    id: 'ocean-glass',
    name: '海面玻璃',
    tags: ['风景'],
    file: 'ocean-glass.jpg',
    kind: 'image',
    params: { accent: '#3F9FB5' }
  },
  {
    id: 'bamboo-rain',
    name: '竹林听雨',
    tags: ['风景'],
    file: 'bamboo-rain.jpg',
    kind: 'image',
    params: { accent: '#4B8F6A' }
  },
  {
    id: 'cyber-neon',
    name: '赛博霓虹',
    tags: ['科技', '城市'],
    file: 'cyber-neon.jpg',
    kind: 'image',
    params: { accent: '#A45CFF' }
  },
  {
    id: 'hologram-city',
    name: '全息都市',
    tags: ['科技', '城市'],
    file: 'hologram-city.jpg',
    kind: 'image',
    params: { accent: '#4CB9F2' }
  },
  {
    id: 'neon-circuit',
    name: '霓虹电路',
    tags: ['科技', '艺术'],
    file: 'neon-circuit.jpg',
    kind: 'image',
    params: { accent: '#20BFF7' }
  },
  {
    id: 'synthwave-grid',
    name: '合成波网格',
    tags: ['科技', '艺术'],
    file: 'synthwave-grid.jpg',
    kind: 'image',
    params: { accent: '#F06A8F' }
  },
  {
    id: 'paper-light',
    name: '纸上微光',
    tags: ['艺术'],
    file: 'paper-light.jpg',
    kind: 'image',
    params: { accent: '#C49A6C' }
  },
  {
    id: 'glass-workspace',
    name: '玻璃工作台',
    tags: ['艺术'],
    file: 'glass-workspace.jpg',
    kind: 'image',
    params: { accent: '#5FA6B3' }
  },
  {
    id: 'soft-geometry',
    name: '柔和几何',
    tags: ['艺术'],
    file: 'soft-geometry.jpg',
    kind: 'image',
    params: { accent: '#D77E6A' }
  },
  {
    id: 'monochrome-lines',
    name: '单色线条',
    tags: ['艺术'],
    file: 'monochrome-lines.jpg',
    kind: 'image',
    params: { accent: '#A7ADB4' }
  },
  {
    id: 'midnight-aurora',
    name: '午夜极光',
    tags: ['风景'],
    file: 'midnight-aurora.jpg',
    kind: 'image',
    params: { accent: '#43D789' }
  },
  {
    id: 'obsidian-glow',
    name: '黑曜微光',
    tags: ['艺术'],
    file: 'obsidian-glow.jpg',
    kind: 'image',
    params: { accent: '#3FA9AF' }
  },
  {
    id: 'starfield',
    name: '静谧星海',
    tags: ['风景'],
    file: 'starfield.jpg',
    kind: 'image',
    params: { accent: '#668FC4' }
  },
  {
    id: 'rainy-night',
    name: '雨夜窗景',
    tags: ['城市'],
    file: 'rainy-night.jpg',
    kind: 'image',
    params: { accent: '#B17B4B' }
  },
  {
    id: 'amber-dusk',
    name: '琥珀黄昏',
    tags: ['城市'],
    file: 'amber-dusk.jpg',
    kind: 'image',
    params: { accent: '#D39645' }
  },
  {
    id: 'peach-sunrise',
    name: '蜜桃日出',
    tags: ['风景'],
    file: 'peach-sunrise.jpg',
    kind: 'image',
    params: { accent: '#E38B78' }
  },
  {
    id: 'candle-atelier',
    name: '烛光工坊',
    tags: ['城市'],
    file: 'candle-atelier.jpg',
    kind: 'image',
    params: { accent: '#C78A4B' }
  },
  {
    id: 'autumn-window',
    name: '秋日窗边',
    tags: ['城市'],
    file: 'autumn-window.jpg',
    kind: 'image',
    params: { accent: '#A65A55' }
  },
  {
    id: 'arina-hashimoto',
    name: '桥本有菜',
    tags: ['人物'],
    file: 'arina-hashimoto.jpg',
    kind: 'image',
    params: { accent: '#C7748E' }
  },
  {
    id: 'ergouzi-paper-comet-light',
    name: '二狗子 · 灵感纸飞机 · 浅色',
    tags: ['动漫', '萌宠'],
    file: 'ergouzi-paper-comet-light.jpg',
    kind: 'image',
    params: { accent: '#E96F79' }
  },
  {
    id: 'ergouzi-paper-comet-dark',
    name: '二狗子 · 灵感纸飞机 · 深色',
    tags: ['动漫', '萌宠'],
    file: 'ergouzi-paper-comet-dark.jpg',
    kind: 'image',
    params: { accent: '#F07D9B' }
  },
  {
    id: 'people-ai-red-horizon',
    name: '人民的AI',
    tags: ['科技', '城市'],
    file: 'people-ai-red-horizon.jpg',
    kind: 'image',
    params: { accent: '#D72E35' }
  },
  {
    id: 'ergouzi-signal-star-light',
    name: '二狗子 · 信号星 · 浅色',
    tags: ['动漫', '人物'],
    file: 'ergouzi-signal-star-light.jpg',
    kind: 'image',
    params: { accent: '#E775A7' }
  },
  {
    id: 'ergouzi-signal-star-dark',
    name: '二狗子 · 信号星 · 深色',
    tags: ['动漫', '人物'],
    file: 'ergouzi-signal-star-dark.jpg',
    kind: 'image',
    params: { accent: '#F080B4' }
  },
  {
    id: 'violet-thunder',
    name: '紫电神影',
    tags: ['动漫', '人物'],
    file: 'violet-thunder.png',
    kind: 'image',
    params: { accent: '#A86BFF' }
  },
  {
    id: 'sunlit-window',
    name: '晴日倚窗',
    tags: ['人物'],
    file: 'sunlit-window.jpg',
    kind: 'image',
    params: { accent: '#B18A6A' }
  },
  {
    id: 'warm-gaze',
    name: '暖光凝眸',
    tags: ['人物'],
    file: 'warm-gaze.jpg',
    kind: 'image',
    params: { accent: '#9A7565' }
  },
  {
    id: 'ink-feather-glow',
    name: '墨羽流光',
    tags: ['动态', '人物'],
    file: 'ink-feather-glow.mp4',
    kind: 'video',
    params: { accent: '#FF8040' }
  },
  {
    id: 'silver-glass-dream',
    name: '银璃幻梦',
    tags: ['动态', '人物', '科技'],
    file: 'silver-glass-dream.mp4',
    kind: 'video',
    params: { accent: '#FF80C0' }
  },
  {
    id: 'lamplit-leisure',
    name: '灯下闲居',
    tags: ['人物', '萌宠'],
    file: 'lamplit-leisure.jpg',
    kind: 'image',
    params: { accent: '#FF8080' }
  },
  {
    id: 'preset-cold-elegance',
    name: '冷艳',
    tags: ['动态'],
    file: 'preset-cold-elegance.mp4',
    kind: 'video',
    params: { accent: '#9FB6C9' }
  },
  {
    id: 'preset-gothic-void-crusade',
    name: 'Gothic Void Crusade',
    tags: ['艺术'],
    file: 'preset-gothic-void-crusade.jpg',
    kind: 'image',
    params: { accent: '#C8A55A' }
  },
  {
    id: 'preset-hokuriku-road',
    name: '公路-北陆-好看',
    tags: ['风景'],
    file: 'preset-hokuriku-road.jpg',
    kind: 'image',
    params: { accent: '#5B7E8F' }
  },
  {
    id: 'preset-summer-forest',
    name: '夏天森林-大树仰拍',
    tags: ['风景'],
    file: 'preset-summer-forest.png',
    kind: 'image',
    params: { accent: '#4B8F6A' }
  },
  {
    id: 'preset-tyndall-rays',
    name: '丁达尔光-光影-光线',
    tags: ['风景'],
    file: 'preset-tyndall-rays.jpg',
    kind: 'image',
    params: { accent: '#B8A67D' }
  }
];
