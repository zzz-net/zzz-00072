const fs = require('fs');

const content = `# 食堂损耗复核台

面向餐饮企业内部质量管理的本地 Web 应用，用于食堂备餐称重数据的规则化异常识别、人工复核改判与历史追溯。

## 功能特性

- **批次管理**：导入称重明细 CSV 或加载预置样例批次，自动校验负数重量等异常行
- **规则引擎**：配置备餐过量、变质怀疑两类判定规则，支持版本管理、变更预演、启用审计和版本回退
- **异常复核**：查看异常列表支持按未结/已关闭和类型筛选，人工改判并记录原因
- **撤销关闭**：已关闭异常可随时撤销恢复为未结，完整保留复核历史
- **报表导出**：批次汇总、异常明细、复核历史三种 CSV 报表
- **数据一致性**：内置一致性校验，确保规则版本、异常证据、人工判定、未结计数与报表互相对得上
- **本地持久化**：SQLite 文件存储，重启自动加载

## 技术栈

- 前端：React 18 + TypeScript + Vite + Tailwind CSS + Zustand + Lucide React
- 后端：Express 4 + TypeScript + better-sqlite3
- 数据：SQLite 本地文件（`data/canteen.db`）

## 快速启动

` + "```" + `bash
# 安装依赖
npm install

# 同时启动前端 (Vite 端口 5173) 和后端 (Express 端口 3002)
npm run dev
` + "```" + `

启动后访问：<http://localhost:5173>

| 命令 | 说明 |
|--------|------|
| ` + "`" + `npm run dev` + "`" + ` | 同时启动前后端开发服务器 |
| ` + "`" + `npm run server:dev` + "`" + ` | 仅启动后端（Express + nodemon 热重载） |
| ` + "`" + `npm run client:dev` + "`" + ` | 仅启动前端（Vite） |
| ` + "`" + `npm run build` + "`" + ` | 构建生产版本 |
| ` + "`" + `npm run check` + "`" + ` | TypeScript 类型检查 |

## 使用流程（界面说明）

### 1. 批次列表页（` + "`" + `/batches` + "`" + `）

打开应用默认进入此页。

- 点击右上角 **「导入样例批次」**：一键生成包含负数重量、备餐过量、变质怀疑的样例数据，快速体验完整流程
- 点击 **「导入 CSV」**：上传自定义 CSV，列需包含 ` + "`" + `dish_name,planned_weight,actual_weight,temperature,timestamp` + "`" + `
- 每个批次卡片显示：总记录、有效记录、异常数、未结数、复核进度条
- 若包含负数重量等无效数据时，卡片显示琥珀色提示「包含 N 条无效记录」
- 再次导入同批次名会提示「该批次已存在」（重复批次保护）
- 点击卡片进入该批次的异常复核页

### 2. 异常复核页（` + "`" + `/batches/:id` + "`" + `）

顶部筛选栏：

- **状态筛选**：全部 / 未结 / 已关闭
- **类型筛选**：全部类型 / 备餐过量 / 变质怀疑

左右两栏布局：

- **左侧**：异常流水列表，点击切换查看详情
- **右侧**：
  - **原始称重数据**：菜品、计划/实际重量、温度、时间
  - **规则命中证据**：JSON 公式化展示（如「实际(600g) - 计划(500g) = 超出100g (20.0%)」），并标注命中的规则版本
  - **人工复核判定**（未结时显示）：选择「判定正常（误报）」或「确认异常」，填写复核原因后提交关闭
  - **已关闭信息**（已关闭时显示）：展示已判定结果和原因，可填写撤销原因后点击「撤销关闭，恢复未结」
  - **复核历史**：时间线记录每次关闭/撤销操作
  - **原始 CSV 行**：留存原始 CSV 原文，作为不可篡改的证据

### 3. 规则配置页（` + "`" + `/rules` + "`" + `）

支持版本管理、变更预演、启用审计和版本回退的完整安全链路：**预演 → 确认 → 审计 → 回退**

#### 四个 Tab 说明

- **规则版本 Tab**：查看所有历史版本，点击「预演并启用」进入变更预演流程
- **预演记录 Tab**：查看最近的预演记录（应用重启后仍可查看）
- **启用日志 Tab**：查看所有版本切换的审计日志（应用重启后仍可查看）
  - ` + "`" + `直接启用` + "`" + `(灰)：通过 API 或导入即生效直接切换
  - ` + "`" + `启用` + "`" + `(蓝)：通过预演确认后正常启用
  - ` + "`" + `回退` + "`" + `(黄)：通过回退包恢复到历史版本
- **回退包 Tab**：管理可导出的回退包（应用重启后仍可使用）
  - 「导出」：下载回退包为 JSON 文件
  - 「导入回退包」：导入外部回退包文件
  - 「应用回退」：将系统恢复到回退包中记录的版本

#### 完整链路说明

1. **预演**：在规则版本 Tab 点击「预演并启用」，系统会生成变更预演（展示当前版本、新版本和具体差异）
2. **确认**：在「变更预演确认」对话框核对变更，确认启用后系统会：① 切换当前生效规则；② 自动生成一个可导出的回退包，方便之后恢复
3. **审计**：在启用日志 Tab 查看所有变更记录，每条日志关联对应的回退包
4. **回退**：在回退包 Tab 找到对应回退包，点击「应用回退」即可恢复到历史版本
5. **失败处理**：
   - 预演已过期（10 分钟有效）→ 重新预演
   - 版本冲突 → 检查版本号是否重复
   - 激活校验不通过 → 检查规则参数是否与已有规则冲突

#### 导入即生效

- 导入规则包时可勾选「导入后将第一条规则设为生效版本」
- 该操作同样会经过完整审计链路，生成启用日志和回退包

#### 新建规则版本

点击「新建规则版本」填写：
- 版本号（唯一）
- 备餐过量阈值（% 和 g，两者任一满足即触发）
- 温度安全范围（低于下限或高于上限即触发变质怀疑）
- 规则描述

### 4. 报表导出页（` + "`" + `/export` + "`" + `）

- 勾选一个或多个批次
- 三种导出：
  - **汇总报表**：按批次统计总记录、有效、错误、异常、未结、已关
  - **明细报表**：每条异常的完整信息（含证据、判定、原因）
  - **复核历史**：全部关闭/撤销操作审计
- 顶部「数据一致性校验」按钮：
  - 校验批次统计 vs 记录/异常表计数一致性
  - 校验生效规则数量
  - 校验异常证据完整性
  - 校验异常状态与判定字段一致性
  - 异常缺失证据等问题

## 失败链路覆盖

| 场景 | 处理方式 |
|--------|----------|
| 负数重量/无效数值 | 标记 ` + "`" + `is_valid=false` + "`" + `，留存 ` + "`" + `raw_line` + "`" + `，不参与规则判定，计入批次 error_records，不影响其他有效数据 |
| 重复批次导入 | 返回 409，前端提示「该批次已存在」 |
| 关闭后再撤销 | 写入 ` + "`" + `review_history` + "`" + ` 完整审计轨迹，批次未结计数同步增减 |
| 单条 CSV 行格式错误 | 逐行校验，单行失败不影响整体导入 |
| 规则版本变更 | 历史异常证据不丢失，每条异常留存当时命中的规则版本 ID 和完整 evidence JSON |

## CSV 格式

` + "```" + `csv
dish_name,planned_weight,actual_weight,temperature,timestamp
红烧肉,500,620,52,2026-06-21T10:30:00.000Z
清炒时蔬,300,-50,3,2026-06-21T10:31:00.000Z
` + "```" + `

- ` + "`" + `dish_name` + "`" + `：菜品名称
- ` + "`" + `planned_weight` + "`" + `：计划重量（g）
- ` + "`" + `actual_weight` + "`" + `：实际重量（g，<=0 视为无效）
- ` + "`" + `temperature` + "`" + `：温度（℃）
- ` + "`" + `timestamp` + "`" + `：ISO 时间戳

## 数据文件

所有数据存储在项目根目录 ` + "`" + `data/canteen.db` + "`" + `（SQLite WAL 模式）。删除该文件可重置全部数据。
`;

fs.writeFileSync('README.md', content, 'utf8');
console.log('Written', content.length, 'chars');
console.log('File size after write:', fs.statSync('README.md').size);

// Verify
function toBytes(s) { return Buffer.from(s, 'utf8'); }
function hasBytes(hay, needle) {
  for (let i = 0; i <= hay.length - needle.length; i++) {
    let m = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i+j] !== needle[j]) { m = false; break; }
    }
    if (m) return true;
  }
  return false;
}

const b = fs.readFileSync('README.md');
const tests = ['预演 → 确认 → 审计 → 回退', '预演并启用', '规则版本 Tab', '直接启用', '1. 预演', '预演已过期', '导入回退包', '应用回退', '导入后将第一条规则设为生效版本', '审计链路', '10 分钟', '重启后仍可'];
console.log('\nVerification:');
let allOk = true;
for (const t of tests) {
  const found = hasBytes(b, toBytes(t));
  if (!found) allOk = false;
  console.log('  ' + (found ? '[OK]' : '[FAIL]') + ' ' + t);
}

// Also check that old text is NOT present
const oldText = '启用此版本';
const hasOld = hasBytes(b, toBytes(oldText));
if (hasOld) {
  console.log('  [FAIL] Old text "' + oldText + '" should not be present');
  allOk = false;
} else {
  console.log('  [OK] Old text "' + oldText + '" correctly absent');
}

console.log(allOk ? '\nAll verified!' : '\nSome failed!');
process.exit(allOk ? 0 : 1);
