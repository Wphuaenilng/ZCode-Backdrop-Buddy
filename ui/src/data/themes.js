import { P } from './params.js';

// 内置占位配色已移除：随包壁纸全部来自 LOCAL_THEMES（真实图片/视频素材）。
const BUILTINS = [];

const LOCAL_THEMES = [
  {
    id: 'romantic-rose',
    name: '浪漫玫瑰',
    tags: ['风景'],
    dot: '#A6536A',
    builtin: false,
    local: true,
    imageFile: 'romantic-rose.jpg',
    params: P({ accent: '#A6536A' })
  },
  {
    id: 'sakura-dawn',
    name: '樱花黎明',
    tags: ['风景'],
    dot: '#D9879D',
    builtin: false,
    local: true,
    imageFile: 'sakura-dawn.jpg',
    params: P({ accent: '#D9879D' })
  },
  {
    id: 'cloud-reverie',
    name: '云端遐想',
    tags: ['风景'],
    dot: '#7B78D6',
    builtin: false,
    local: true,
    imageFile: 'cloud-reverie.jpg',
    params: P({ accent: '#7B78D6' })
  },
  {
    id: 'moonlit-garden',
    name: '月光花园',
    tags: ['风景'],
    dot: '#7286D9',
    builtin: false,
    local: true,
    imageFile: 'moonlit-garden.jpg',
    params: P({ accent: '#7286D9' })
  },
  {
    id: 'forest-mist',
    name: '森林薄雾',
    tags: ['风景'],
    dot: '#6F9275',
    builtin: false,
    local: true,
    imageFile: 'forest-mist.jpg',
    params: P({ accent: '#6F9275' })
  },
  {
    id: 'alpine-dawn',
    name: '山巅晨光',
    tags: ['风景'],
    dot: '#7191A8',
    builtin: false,
    local: true,
    imageFile: 'alpine-dawn.jpg',
    params: P({ accent: '#7191A8' })
  },
  {
    id: 'ocean-glass',
    name: '海面玻璃',
    tags: ['风景'],
    dot: '#3F9FB5',
    builtin: false,
    local: true,
    imageFile: 'ocean-glass.jpg',
    params: P({ accent: '#3F9FB5' })
  },
  {
    id: 'bamboo-rain',
    name: '竹林听雨',
    tags: ['风景'],
    dot: '#4B8F6A',
    builtin: false,
    local: true,
    imageFile: 'bamboo-rain.jpg',
    params: P({ accent: '#4B8F6A' })
  },
  {
    id: 'cyber-neon',
    name: '赛博霓虹',
    tags: ['科技', '城市'],
    dot: '#A45CFF',
    builtin: false,
    local: true,
    imageFile: 'cyber-neon.jpg',
    params: P({ accent: '#A45CFF' })
  },
  {
    id: 'hologram-city',
    name: '全息都市',
    tags: ['科技', '城市'],
    dot: '#4CB9F2',
    builtin: false,
    local: true,
    imageFile: 'hologram-city.jpg',
    params: P({ accent: '#4CB9F2' })
  },
  {
    id: 'neon-circuit',
    name: '霓虹电路',
    tags: ['科技', '艺术'],
    dot: '#20BFF7',
    builtin: false,
    local: true,
    imageFile: 'neon-circuit.jpg',
    params: P({ accent: '#20BFF7' })
  },
  {
    id: 'synthwave-grid',
    name: '合成波网格',
    tags: ['科技', '艺术'],
    dot: '#F06A8F',
    builtin: false,
    local: true,
    imageFile: 'synthwave-grid.jpg',
    params: P({ accent: '#F06A8F' })
  },
  {
    id: 'paper-light',
    name: '纸上微光',
    tags: ['艺术'],
    dot: '#C49A6C',
    builtin: false,
    local: true,
    imageFile: 'paper-light.jpg',
    params: P({ accent: '#C49A6C' })
  },
  {
    id: 'glass-workspace',
    name: '玻璃工作台',
    tags: ['艺术'],
    dot: '#5FA6B3',
    builtin: false,
    local: true,
    imageFile: 'glass-workspace.jpg',
    params: P({ accent: '#5FA6B3' })
  },
  {
    id: 'soft-geometry',
    name: '柔和几何',
    tags: ['艺术'],
    dot: '#D77E6A',
    builtin: false,
    local: true,
    imageFile: 'soft-geometry.jpg',
    params: P({ accent: '#D77E6A' })
  },
  {
    id: 'monochrome-lines',
    name: '单色线条',
    tags: ['艺术'],
    dot: '#A7ADB4',
    builtin: false,
    local: true,
    imageFile: 'monochrome-lines.jpg',
    params: P({ accent: '#A7ADB4' })
  },
  {
    id: 'midnight-aurora',
    name: '午夜极光',
    tags: ['风景'],
    dot: '#43D789',
    builtin: false,
    local: true,
    imageFile: 'midnight-aurora.jpg',
    params: P({ accent: '#43D789' })
  },
  {
    id: 'obsidian-glow',
    name: '黑曜微光',
    tags: ['艺术'],
    dot: '#3FA9AF',
    builtin: false,
    local: true,
    imageFile: 'obsidian-glow.jpg',
    params: P({ accent: '#3FA9AF' })
  },
  {
    id: 'starfield',
    name: '静谧星海',
    tags: ['风景'],
    dot: '#668FC4',
    builtin: false,
    local: true,
    imageFile: 'starfield.jpg',
    params: P({ accent: '#668FC4' })
  },
  {
    id: 'rainy-night',
    name: '雨夜窗景',
    tags: ['城市'],
    dot: '#B17B4B',
    builtin: false,
    local: true,
    imageFile: 'rainy-night.jpg',
    params: P({ accent: '#B17B4B' })
  },
  {
    id: 'amber-dusk',
    name: '琥珀黄昏',
    tags: ['城市'],
    dot: '#D39645',
    builtin: false,
    local: true,
    imageFile: 'amber-dusk.jpg',
    params: P({ accent: '#D39645' })
  },
  {
    id: 'peach-sunrise',
    name: '蜜桃日出',
    tags: ['风景'],
    dot: '#E38B78',
    builtin: false,
    local: true,
    imageFile: 'peach-sunrise.jpg',
    params: P({ accent: '#E38B78' })
  },
  {
    id: 'candle-atelier',
    name: '烛光工坊',
    tags: ['城市'],
    dot: '#C78A4B',
    builtin: false,
    local: true,
    imageFile: 'candle-atelier.jpg',
    params: P({ accent: '#C78A4B' })
  },
  {
    id: 'autumn-window',
    name: '秋日窗边',
    tags: ['城市'],
    dot: '#A65A55',
    builtin: false,
    local: true,
    imageFile: 'autumn-window.jpg',
    params: P({ accent: '#A65A55' })
  },
  {
    id: 'arina-hashimoto',
    name: '桥本有菜',
    tags: ['人物'],
    dot: '#C7748E',
    builtin: false,
    local: true,
    imageFile: 'arina-hashimoto.jpg',
    params: P({ accent: '#C7748E' })
  },
  {
    id: 'ergouzi-paper-comet-light',
    name: '二狗子 · 灵感纸飞机 · 浅色',
    tags: ['动漫', '萌宠'],
    dot: '#E96F79',
    builtin: false,
    local: true,
    imageFile: 'ergouzi-paper-comet-light.jpg',
    params: P({ accent: '#E96F79' })
  },
  {
    id: 'ergouzi-paper-comet-dark',
    name: '二狗子 · 灵感纸飞机 · 深色',
    tags: ['动漫', '萌宠'],
    dot: '#F07D9B',
    builtin: false,
    local: true,
    imageFile: 'ergouzi-paper-comet-dark.jpg',
    params: P({ accent: '#F07D9B' })
  },
  {
    id: 'people-ai-red-horizon',
    name: '人民的AI',
    tags: ['科技', '城市'],
    dot: '#D72E35',
    builtin: false,
    local: true,
    imageFile: 'people-ai-red-horizon.jpg',
    params: P({ accent: '#D72E35' })
  },
  {
    id: 'ergouzi-signal-star-light',
    name: '二狗子 · 信号星 · 浅色',
    tags: ['动漫', '人物'],
    dot: '#E775A7',
    builtin: false,
    local: true,
    imageFile: 'ergouzi-signal-star-light.jpg',
    params: P({ accent: '#E775A7' })
  },
  {
    id: 'ergouzi-signal-star-dark',
    name: '二狗子 · 信号星 · 深色',
    tags: ['动漫', '人物'],
    dot: '#F080B4',
    builtin: false,
    local: true,
    imageFile: 'ergouzi-signal-star-dark.jpg',
    params: P({ accent: '#F080B4' })
  },
  {
    id: 'violet-thunder',
    name: '紫电神影',
    tags: ['动漫', '人物'],
    dot: '#A86BFF',
    builtin: false,
    local: true,
    imageFile: 'violet-thunder.png',
    params: P({ accent: '#A86BFF' })
  },
  {
    id: 'sunlit-window',
    name: '晴日倚窗',
    tags: ['人物'],
    dot: '#B18A6A',
    builtin: false,
    local: true,
    imageFile: 'sunlit-window.jpg',
    params: P({ accent: '#B18A6A' })
  },
  {
    id: 'warm-gaze',
    name: '暖光凝眸',
    tags: ['人物'],
    dot: '#9A7565',
    builtin: false,
    local: true,
    imageFile: 'warm-gaze.jpg',
    params: P({ accent: '#9A7565' })
  },
  {
    id: 'ink-feather-glow',
    name: '墨羽流光',
    tags: ['动态', '人物'],
    dot: '#FF8040',
    builtin: false,
    local: true,
    video: true,
    videoFile: 'ink-feather-glow.mp4',
    params: P({ accent: '#FF8040' })
  },
  {
    id: 'silver-glass-dream',
    name: '银璃幻梦',
    tags: ['动态', '人物', '科技'],
    dot: '#FF80C0',
    builtin: false,
    local: true,
    video: true,
    videoFile: 'silver-glass-dream.mp4',
    params: P({ accent: '#FF80C0' })
  },
  {
    id: 'lamplit-leisure',
    name: '灯下闲居',
    tags: ['人物', '萌宠'],
    dot: '#FF8080',
    builtin: false,
    local: true,
    imageFile: 'lamplit-leisure.jpg',
    params: P({ accent: '#FF8080' })
  },
  {
    id: 'preset-cold-elegance',
    name: '冷艳',
    tags: ['动态'],
    dot: '#9FB6C9',
    builtin: false,
    local: true,
    video: true,
    videoFile: 'preset-cold-elegance.mp4',
    params: P({ accent: '#9FB6C9' })
  },
  {
    id: 'preset-gothic-void-crusade',
    name: 'Gothic Void Crusade',
    tags: ['艺术'],
    dot: '#C8A55A',
    builtin: false,
    local: true,
    imageFile: 'preset-gothic-void-crusade.jpg',
    params: P({ accent: '#C8A55A' })
  },
  {
    id: 'preset-hokuriku-road',
    name: '公路-北陆-好看',
    tags: ['风景'],
    dot: '#5B7E8F',
    builtin: false,
    local: true,
    imageFile: 'preset-hokuriku-road.jpg',
    params: P({ accent: '#5B7E8F' })
  },
  {
    id: 'preset-summer-forest',
    name: '夏天森林-大树仰拍',
    tags: ['风景'],
    dot: '#4B8F6A',
    builtin: false,
    local: true,
    imageFile: 'preset-summer-forest.png',
    params: P({ accent: '#4B8F6A' })
  },
  {
    id: 'preset-tyndall-rays',
    name: '丁达尔光-光影-光线',
    tags: ['风景'],
    dot: '#B8A67D',
    builtin: false,
    local: true,
    imageFile: 'preset-tyndall-rays.jpg',
    params: P({ accent: '#B8A67D' })
  }
];

export { BUILTINS, LOCAL_THEMES };

export const isNative = () =>
  typeof window !== 'undefined' && !!window.chrome && !!window.chrome.webview;

export function mediaUrl(file) {
  const base = isNative() ? 'https://media.backdropbuddy.invalid/' : '/dev-media/';
  return base + encodeURIComponent(file);
}

export function themeVisual(theme) {
  if (!theme) return {};

  if (theme.media && theme.media.kind === 'video') {
    return { video: theme.media.url, poster: theme.media.thumbUrl || '' };
  }
  if (theme.media && theme.media.kind === 'image') {
    return { image: theme.media.url, thumb: theme.media.thumbUrl || theme.media.url };
  }
  if (theme.videoSrc) return { video: theme.videoSrc };
  if (theme.videoFile) return { video: mediaUrl(theme.videoFile) };
  if (theme.imageSrc) return { image: theme.imageSrc };
  if (theme.imageFile) return { image: mediaUrl(theme.imageFile) };
  if (theme.image) return { image: theme.image };
  if (theme.bg) return { bg: theme.bg };
  if (theme.params && theme.params.accent) {
    return { bg: `linear-gradient(160deg, ${theme.params.accent}55, #F4F1EA 72%)` };
  }

  return { bg: 'linear-gradient(180deg,#F7F8FB,#EEF1F6)' };
}

export function themeThumb(theme) {
  if (!theme) return {};
  if (theme.video || theme.videoFile || (theme.media && theme.media.kind === 'video')) {
    return { video: true, poster: theme.media?.thumbUrl || (theme.videoFile ? themeVisual(theme).video : '') };
  }
  const visual = themeVisual(theme);
  if (visual.thumb) return { image: visual.thumb };
  if (visual.image) return { image: visual.image };
  if (visual.bg) return { bg: visual.bg };
  return { bg: 'linear-gradient(180deg,#F4F5F9,#E7E9F0)' };
}
