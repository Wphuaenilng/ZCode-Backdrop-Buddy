import { EMPTY } from './common.mjs';

// workshop.scan 不带参数：Steam 位置由发现链（设置 → 环境变量 → 常见路径 → 注册表）决定。
export const workshopScan = EMPTY;

// id 是扫描结果回传的条目标识（工坊目录名或其安全哈希），
// 不是路径——媒体路径只存在于内核的扫描缓存里，UI 永远拿不到也不需要。
export const workshopImport = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_.-]+$' }
  }
};
