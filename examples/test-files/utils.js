// JavaScript 工具文件
const fs = require('fs');
const path = require('path');

class FileUtils {
  static readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
  }
  
  static writeFile(filePath, content) {
    fs.writeFileSync(filePath, content);
  }
  
  static exists(filePath) {
    return fs.existsSync(filePath);
  }
}

function processFiles(files) {
  return files.map(file => {
    if (FileUtils.exists(file)) {
      return FileUtils.readFile(file);
    }
    return null;
  });
}

module.exports = { FileUtils, processFiles };
