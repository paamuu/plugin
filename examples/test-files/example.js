"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExampleClass = void 0;
exports.createExample = createExample;
// TypeScript 示例文件
class ExampleClass {
    constructor(name) {
        this.name = name;
    }
    getName() {
        return this.name;
    }
    async processData() {
        console.log('Processing data...');
    }
}
exports.ExampleClass = ExampleClass;
function createExample(name) {
    return new ExampleClass(name);
}
// TODO: 添加更多功能
// FIXME: 修复类型定义问题
//# sourceMappingURL=example.js.map