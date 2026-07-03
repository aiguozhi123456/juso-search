import '@testing-library/jest-dom/vitest';

// t() 在无 browser.i18n 时安全回退到 messageName，故无需全局 stub。
// 需要断言具体文案的页面测试各自 mock @/lib/i18n。
