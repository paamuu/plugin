// TypeScript 示例文件
export class ExampleClass {
  private name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  public getName(): string {
    return this.name;
  }
  
  public async processData(): Promise<void> {
    console.log('Processing data...');
  }
}

export interface ExampleInterface {
  id: number;
  title: string;
}

export function createExample(name: string): ExampleClass {
  return new ExampleClass(name);
}

// TODO: 添加更多功能
// FIXME: 修复类型定义问题
