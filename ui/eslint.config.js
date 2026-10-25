// 只拦一类错误：组件体内 const/let/class 先用后声明（TDZ）。
// 这种错误 vite 构建不报、内核测试看不见，React 首渲染直接整页崩溃
// （2026-10-25 连续三次：bridge.js listeners.set、callKernel、activeHostName）。
// 函数声明有合法提升，不拦；保持规则集最小，避免误报噪声。
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true, allowNamedExports: false }],
      // 源码里已有 react-hooks 的 disable 注释；本配置不装该插件，注册为 off 让注释合法
      'react-hooks/exhaustive-deps': 'off'
    }
  }
];
