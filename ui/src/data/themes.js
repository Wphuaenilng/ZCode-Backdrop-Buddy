import { P } from './params.js';

const BUILTINS = [
  {
    id: 'sakura', name: '樱花黎明', tags: ['风景', '艺术'], dot: '#D8A0A8',
    bg: `radial-gradient(circle at 18% 22%, rgba(255,222,222,.62) 0 4%, transparent 4.6%),radial-gradient(circle at 30% 34%, rgba(255,232,232,.42) 0 7%, transparent 7.6%),radial-gradient(circle at 74% 16%, rgba(255,242,234,.55) 0 5%, transparent 5.6%),linear-gradient(160deg, rgba(30,22,30,.55) 0 18%, transparent 34%),linear-gradient(180deg,#2B2533 0%,#6E4B57 32%,#C9837D 58%,#F0C0A8 82%,#F6D9BF 100%)`,
    params: P({ accent: '#C98F8F' })
  },
  {
    id: 'moon', name: '月光花园', tags: ['风景'], dot: '#7FBFA8',
    bg: `radial-gradient(circle at 72% 20%, #F2F6EA 0 4%, rgba(242,246,234,.18) 4.6%, transparent 10%),radial-gradient(circle at 24% 80%, rgba(74,140,104,.5) 0 20%, transparent 46%),radial-gradient(circle at 80% 70%, rgba(48,104,82,.4) 0 18%, transparent 42%),linear-gradient(180deg,#08161C 0%,#0D2A2B 45%,#1B4A3A 75%,#254B3A 100%)`,
    params: P({ accent: '#6F9275' })
  },
  {
    id: 'forest', name: '森林薄雾', tags: ['风景'], dot: '#8FB59B',
    bg: `linear-gradient(107deg, rgba(236,244,231,0) 0%, rgba(236,244,231,.5) 24%, rgba(236,244,231,.05) 45%, transparent 55%),linear-gradient(75deg, transparent 0 62%, rgba(230,240,228,.24) 72%, transparent 82%),repeating-linear-gradient(90deg, transparent 0 22px, rgba(10,30,20,.18) 23px 26px, transparent 27px 48px),linear-gradient(180deg,#12281F 0%,#244A35 38%,#3F6B4A 68%,#76947A 100%)`,
    params: P({ x: 76, y: 45, safe: 'left', task: 'ambient', panel: 30, accent: '#6F9275' })
  },
  {
    id: 'mountain', name: '山麓晨光', tags: ['风景'], dot: '#D0A887',
    bg: `linear-gradient(180deg,#F3D3B4 0%,#EAB896 36%,#C98D78 52%, transparent 52.5%),linear-gradient(165deg, transparent 0 56%, #5A6A62 56.5% 68%, transparent 68.5%),linear-gradient(150deg, transparent 0 60%, #3B4A44 60.5% 74%, transparent 74.5%),linear-gradient(180deg,#B8C3C2 0%,#7E8F86 52%,#27372F 100%)`,
    params: P({ accent: '#B98A63' })
  },
  {
    id: 'bamboo', name: '竹林听雨', tags: ['风景'], dot: '#7FAE8A',
    bg: `repeating-linear-gradient(92deg, rgba(20,50,30,0) 0 18px, rgba(18,52,30,.7) 19px 23px, rgba(18,52,30,0) 24px 46px),repeating-linear-gradient(100deg, transparent 0 14px, rgba(210,230,215,.13) 15px 16px, transparent 17px 30px),linear-gradient(180deg, rgba(190,210,190,.16), transparent 48%),linear-gradient(180deg,#1C3B28 0%,#2E5538 55%,#1A3324 100%)`,
    params: P({ accent: '#7FAE8A' })
  },
  {
    id: 'cyber', name: '赛博霓虹', tags: ['城市', '科技', '动态'], dot: '#B97BE6',
    bg: `radial-gradient(circle at 70% 18%, rgba(170,70,255,.5), transparent 36%),radial-gradient(circle at 22% 62%, rgba(0,220,255,.32), transparent 32%),repeating-linear-gradient(90deg, transparent 0 30px, rgba(255,50,180,.16) 30px 31px),repeating-linear-gradient(0deg, transparent 0 34px, rgba(80,140,255,.12) 34px 35px),linear-gradient(180deg,#090A1A 0%,#141032 50%,#20103A 78%,#0A0E20 100%)`,
    params: P({ accent: '#B97BE6' })
  },
  {
    id: 'hologram', name: '全息都市', tags: ['城市', '科技'], dot: '#6FA8D8',
    bg: `linear-gradient(180deg,#9BC8E8 0%,#4D7FA8 38%,#1C3350 56%,#071522 100%),linear-gradient(90deg, transparent 0 6%, rgba(14,34,60,.72) 6% 11%, transparent 11% 20%, rgba(14,34,60,.66) 20% 28%, transparent 28% 40%, rgba(9,26,46,.76) 40% 54%, transparent 54% 68%, rgba(14,34,60,.66) 68% 78%, transparent 78%)`,
    params: P({ accent: '#6FA8D8' })
  },
  {
    id: 'circuit', name: '霓虹电路', tags: ['科技', '动态'], dot: '#4EC9E6',
    bg: `radial-gradient(circle at 28% 38%, rgba(0,220,255,.26), transparent 30%),repeating-linear-gradient(90deg, transparent 0 28px, rgba(30,220,255,.3) 28px 29px, transparent 29px 58px),repeating-linear-gradient(0deg, transparent 0 36px, rgba(60,120,255,.18) 36px 37px, transparent 37px 78px),linear-gradient(180deg,#04111C 0%,#07263A 55%,#020B14 100%)`,
    params: P({ accent: '#4EC9E6' })
  },
  {
    id: 'synthwave', name: '合成波网格', tags: ['科技', '艺术', '动态'], dot: '#E47BB0',
    bg: `radial-gradient(circle at 50% 46%, #FFC27A 0 9%, rgba(255,153,102,.35) 10%, transparent 28%),repeating-linear-gradient(90deg, transparent 0 30px, rgba(255,90,180,.25) 30px 31px),repeating-linear-gradient(0deg, transparent 0 26px, rgba(255,90,180,.2) 26px 27px),linear-gradient(180deg,#140C2E 0%,#4C1B5A 34%,#C24A6A 52%,#F49A5B 56%,#151028 56.5%,#0B0A16 100%)`,
    params: P({ accent: '#E47BB0' })
  },
  {
    id: 'paper', name: '纸上微光', tags: ['艺术'], dot: '#B9B5A8',
    bg: `linear-gradient(135deg, rgba(255,255,255,.7) 0%, transparent 35%),linear-gradient(45deg, rgba(218,218,222,.55) 0%, transparent 42%),repeating-linear-gradient(120deg, transparent 0 80px, rgba(175,175,170,.14) 80px 82px),linear-gradient(180deg,#F7F7F4 0%,#E9E9E4 52%,#DADAD6 100%)`,
    params: P({ accent: '#8E8978' })
  },
  {
    id: 'geometry', name: '柔和几何', tags: ['艺术'], dot: '#D8A9A2',
    bg: `radial-gradient(circle at 22% 30%, #F4D8D2 0 18%, transparent 18.6%),radial-gradient(circle at 70% 68%, #C9DDE3 0 22%, transparent 22.6%),radial-gradient(circle at 52% 48%, #F0E6D2 0 15%, transparent 15.6%),linear-gradient(135deg,#DCE6E4,#EADDD5)`,
    params: P({ accent: '#C08F87' })
  },
  {
    id: 'mono', name: '单色线条', tags: ['艺术'], dot: '#9A9A9A',
    bg: `repeating-radial-gradient(circle at 30% 40%, transparent 0 10px, rgba(230,230,232,.2) 11px 12px, transparent 13px 22px),linear-gradient(160deg,#202124,#3A3B3F 50%,#141517 100%)`,
    params: P({ accent: '#B7B7B7' })
  },
  {
    id: 'aurora', name: '午夜极光', tags: ['风景', '动态'], dot: '#5ED1A6',
    bg: `radial-gradient(circle at 20% 80%, rgba(40,220,160,.35), transparent 38%),radial-gradient(circle at 70% 30%, rgba(90,180,255,.2), transparent 34%),repeating-linear-gradient(115deg, transparent 0 42px, rgba(60,220,170,.12) 42px 50px, transparent 50px 96px),linear-gradient(180deg,#050B18 0%,#0A1730 50%,#07101C 100%)`,
    params: P({ accent: '#5ED1A6' })
  },
  {
    id: 'dark', name: '黑暗微光', tags: ['科技', '艺术'], dot: '#5C8C88',
    bg: `radial-gradient(circle at 70% 25%, rgba(40,120,110,.24), transparent 30%),radial-gradient(circle at 20% 78%, rgba(100,80,180,.16), transparent 34%),linear-gradient(180deg,#050708 0%,#0B1012 55%,#030505 100%)`,
    params: P({ accent: '#5C8C88' })
  },
  {
    id: 'stars', name: '静谧星海', tags: ['风景', '动态'], dot: '#7E9ED8',
    bg: `radial-gradient(circle at 12% 18%, rgba(255,255,255,.85) 0 1px, transparent 1.6px),radial-gradient(circle at 32% 62%, rgba(255,255,255,.6) 0 1px, transparent 1.6px),radial-gradient(circle at 68% 24%, rgba(255,255,255,.8) 0 1.5px, transparent 2px),radial-gradient(circle at 82% 72%, rgba(200,220,255,.7) 0 1px, transparent 1.6px),radial-gradient(circle at 56% 76%, rgba(255,255,255,.6) 0 1px, transparent 1.6px),radial-gradient(circle at 48% 42%, rgba(120,180,255,.14), transparent 30%),linear-gradient(180deg,#030716 0%,#071A33 52%,#02040C 100%)`,
    params: P({ accent: '#7E9ED8' })
  },
  {
    id: 'rain', name: '雨夜窗景', tags: ['城市', '艺术'], dot: '#D9A06A',
    bg: `radial-gradient(circle at 18% 30%, rgba(255,190,110,.48) 0 3%, transparent 8%),radial-gradient(circle at 42% 22%, rgba(120,180,255,.32) 0 2%, transparent 6%),radial-gradient(circle at 76% 44%, rgba(255,140,180,.3) 0 2%, transparent 6%),repeating-linear-gradient(100deg, transparent 0 10px, rgba(210,225,240,.13) 10px 11px, transparent 11px 22px),linear-gradient(180deg,#08111B 0%,#102337 55%,#050A10 100%)`,
    params: P({ accent: '#D9A06A' })
  },
  {
    id: 'amber', name: '琥珀黄昏', tags: ['风景', '艺术'], dot: '#D19A65',
    bg: `radial-gradient(circle at 50% 42%, rgba(255,214,150,.78) 0 7%, transparent 22%),linear-gradient(180deg,#3A1D26 0%,#8C4A3D 38%,#D98B55 62%,#F1C386 80%,#3A1D26 100%)`,
    params: P({ accent: '#C98A55' })
  },
  {
    id: 'peach', name: '蜜桃日出', tags: ['风景'], dot: '#E7A6A0',
    bg: `radial-gradient(circle at 50% 38%, #FFF0D6 0 6%, transparent 18%),linear-gradient(180deg,#5D4C6E 0%,#B57A85 36%,#F0A58F 62%,#F8CDB0 82%,#FBE6D0 100%)`,
    params: P({ accent: '#D98F87' })
  },
  {
    id: 'candle', name: '烛光工坊', tags: ['艺术'], dot: '#D9A35F',
    bg: `radial-gradient(circle at 58% 62%, rgba(255,190,90,.72) 0 5%, rgba(255,170,80,.16) 18%, transparent 35%),radial-gradient(circle at 30% 30%, rgba(90,60,40,.3), transparent 35%),linear-gradient(180deg,#120C09 0%,#2E1C12 55%,#0B0705 100%)`,
    params: P({ accent: '#C98A45' })
  },
  {
    id: 'autumn', name: '秋日窗边', tags: ['风景', '艺术'], dot: '#C0845C',
    bg: `linear-gradient(180deg, rgba(255,214,150,.42) 0%, transparent 40%),repeating-linear-gradient(90deg, transparent 0 62px, rgba(80,50,30,.24) 62px 66px),radial-gradient(circle at 70% 30%, rgba(255,180,90,.48), transparent 32%),linear-gradient(180deg,#3A2418 0%,#7A4E2C 45%,#2A1810 100%)`,
    params: P({ accent: '#B97B4E' })
  }
].map((theme) => ({ ...theme, builtin: true }));

const LOCAL_THEMES = [
  {
    id: 'local-original',
    name: '原图素材',
    tags: ['风景', '艺术'],
    dot: '#C6A15B',
    builtin: false,
    local: true,
    imageFile: 'original.jpg',
    params: P({ accent: '#C6A15B' })
  },
  {
    id: 'local-video',
    name: '原视频素材',
    tags: ['动态', '城市'],
    dot: '#7E9ED8',
    builtin: false,
    local: true,
    video: true,
    videoFile: 'original.mp4',
    params: P({ accent: '#7E9ED8' })
  },
  {
    id: 'local-test',
    name: '测试233',
    tags: ['艺术'],
    dot: '#D8A0A8',
    builtin: false,
    local: true,
    imageFile: '测试233.jpg',
    params: P({ accent: '#D8A0A8' })
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
