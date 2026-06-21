## 1. 架构设计

```mermaid
graph TD
    subgraph "前端 React 18"
        A["批次列表页"] --> B["状态管理 Zustand"]
        C["异常复核页"] --> B
        D["规则配置页"] --> B
        E["报表导出页"] --> B
        B --> F["React Router 路由"]
    end
    subgraph "后端 Express"
        G["批次 API"]
        H["异常 API"]
        I["规则 API"]
        J["导出 API"]
    end
    subgraph "数据层"
        K["better-sqlite3 本地数据库"]
        L["文件系统（CSV导入导出）"]
    end
    A --> G
    C --> H
    D --> I
    E --> J
    G --> K
    H --> K
    I --> K
    J --> L
    J --> K
```

## 2. 技术描述
- 前端：React 18 + TypeScript + Vite + Tailwind CSS 3 + Zustand + Lucide React
- 后端：Express 4 + TypeScript + better-sqlite3（同步SQLite，本地应用无需额外数据库服务）
- 初始化工具：vite-init（react-express-ts 模板）
- 数据持久化：SQLite 本地文件 `data/canteen.db`，重启自动加载
- 文件处理：csv-parse（导入），原生 fs + 字符串拼接（导出 CSV）

## 3. 路由定义
| 前端路由 | 页面组件 | 用途 |
|----------|----------|------|
| / | 重定向到 /batches | 首页跳转 |
| /batches | BatchList | 批次列表、导入入口 |
| /batches/:id | ReviewList | 指定批次的异常复核列表 |
| /rules | RuleConfig | 损耗规则配置 |
| /export | ReportExport | 报表导出 |

| 后端 API | Method | 用途 |
|----------|--------|------|
| /api/batches | GET | 获取所有批次列表 |
| /api/batches | POST | 导入新批次（multipart/form-data 上传 CSV） |
| /api/batches/sample | POST | 导入预置样例批次 |
| /api/batches/:id | GET | 获取批次详情（含统计） |
| /api/anomalies | GET | 按批次/状态获取异常列表 |
| /api/anomalies/:id | GET | 获取异常详情（含规则证据） |
| /api/anomalies/:id/resolve | POST | 人工改判关闭异常 |
| /api/anomalies/:id/reopen | POST | 撤销关闭，恢复未结 |
| /api/rules | GET | 获取规则列表（含历史版本） |
| /api/rules | POST | 创建新版本规则 |
| /api/rules/import | POST | 批量导入规则（支持 activate=1 立即生效，走统一审计链路） |
| /api/rules/export | GET | 导出全部规则为 JSON 包（含 schema_version） |
| /api/rules/:id/activate | POST | 直接激活指定规则版本（生成审计日志+回退包） |
| /api/rules/previews | GET | 获取预演记录列表 |
| /api/rules/previews | POST | 创建变更预演（计算差异但不切换） |
| /api/rules/previews/:id/confirm | POST | 确认预演并执行启用（生成审计日志+回退包） |
| /api/rules/previews/:id/cancel | POST | 取消待确认的预演 |
| /api/rules/previews/:id/diff | GET | 获取预演的差异对比详情 |
| /api/rules/activation-logs | GET | 获取启用审计日志列表 |
| /api/rules/rollback-packages | GET | 获取回退包列表 |
| /api/rules/rollback-packages/:id | GET | 获取单个回退包详情 |
| /api/rules/rollback-packages/:id/export | GET | 导出回退包为 JSON 文件 |
| /api/rules/rollback-packages/apply | POST | 应用回退包（生成审计日志+新回退包） |
| /api/export/summary | GET | 导出批次汇总 CSV |
| /api/export/detail | GET | 导出批次明细 CSV |
| /api/consistency/check | GET | 数据一致性校验接口 |

## 4. 数据模型

```mermaid
erDiagram
    BATCH ||--o{ WEIGHING_RECORD : contains
    BATCH ||--o{ ANOMALY : has
    RULE ||--o{ ANOMALY : "detected by"
    ANOMALY ||--o{ REVIEW_HISTORY : has
    RULE_PREVIEW }|--|| RULE : "targets"
    RULE_PREVIEW }|--|| RULE : "anchors"
    RULE_ACTIVATION_LOG }|--|| RULE : "activates to"
    RULE_ACTIVATION_LOG }|--|| RULE : "activates from"
    RULE_ACTIVATION_LOG }|--|| RULE_ROLLBACK_PACKAGE : "references"
    RULE_ROLLBACK_PACKAGE ||--o{ RULE_ACTIVATION_LOG : "used by"

    BATCH {
        string id PK "批次ID"
        string name "批次名称"
        string import_date "导入日期"
        int total_records "总记录数"
        int valid_records "有效记录数"
        int error_records "错误记录数"
        int anomaly_count "异常总数"
        int unresolved_count "未结异常数"
        string status "状态"
        string rule_version_id FK "使用的规则版本"
    }

    WEIGHING_RECORD {
        string id PK
        string batch_id FK
        string dish_name "菜品名称"
        float planned_weight "计划重量(g)"
        float actual_weight "实际重量(g)"
        float temperature "温度(℃)"
        string timestamp "称重时间"
        boolean is_valid "是否有效"
        string error_reason "无效原因"
        string raw_line "原始行数据(留存证据)"
    }

    RULE {
        string id PK
        string version "版本号"
        boolean is_active "是否生效"
        float over_prep_threshold_pct "备餐过量阈值%"
        float over_prep_threshold_abs "备餐过量阈值(g)"
        float spoilage_temp_min "变质怀疑-最低温"
        float spoilage_temp_max "变质怀疑-最高温"
        string created_at "创建时间"
        string description "规则描述"
    }

    ANOMALY {
        string id PK
        string batch_id FK
        string record_id FK
        string rule_version_id FK
        string anomaly_type "备餐过量/变质怀疑"
        string evidence "命中证据JSON"
        string status "未结/已关闭"
        string manual_reason "人工原因"
        string manual_result "正常/确认异常"
        string resolved_at "关闭时间"
        string created_at "创建时间"
    }

    REVIEW_HISTORY {
        string id PK
        string anomaly_id FK
        string action "关闭/撤销"
        string reason "原因"
        string result "判定结果"
        string operator "操作人"
        string timestamp "操作时间"
    }

    RULE_PREVIEW {
        string id PK
        string target_rule_id FK "预演目标规则ID"
        string anchor_rule_id FK "预演锚点(当前生效)规则ID"
        string diff_json "阈值差异对比JSON"
        string status "pending/confirmed/cancelled/expired"
        string operator "操作人"
        string created_at "创建时间"
        string expires_at "过期时间(创建后10分钟)"
    }

    RULE_ACTIVATION_LOG {
        string id PK
        string from_rule_id FK "切换前生效规则ID"
        string to_rule_id FK "切换后生效规则ID"
        string action "direct(直接启用)/activate(预演确认)/rollback(回退)"
        string operator "操作人"
        string rollback_package_id FK "关联回退包ID"
        string detail_json "完整细节(JSON)，含阈值差异和全量快照引用"
        string created_at "创建时间"
    }

    RULE_ROLLBACK_PACKAGE {
        string id PK
        string name "回退包名称"
        string description "回退包描述"
        string to_rule_id FK "回退目标规则ID"
        string all_rules_snapshot_json "所有规则版本快照JSON"
        string schema_version "导出格式版本号"
        string created_by "创建人"
        string created_at "创建时间"
    }
```

## 5. 失败链路设计

1. **负数重量处理**：导入时检测 `actual_weight <= 0` 的行，标记 `is_valid=false`，记录 `error_reason="负数重量"`，保留 `raw_line`，不参与规则判定，但计入批次统计
2. **重复批次导入**：POST `/api/batches` 时检查批次ID是否已存在，返回 409 错误，前端提示"该批次已导入"
3. **关闭后撤销**：`ANOMALY.status` 支持 `unresolved → resolved → unresolved` 流转，每次操作写入 `REVIEW_HISTORY`，保留完整审计轨迹
4. **错误行不影响可用数据**：导入采用逐行校验策略，单行失败不阻断其他行，批次最终状态反映有效/错误数量
5. **规则证据留存**：每条异常的 `evidence` 字段存储完整 JSON（命中的规则ID、阈值、实际值、计算公式），规则版本删除时级联不清理证据
6. **版本切换失败回滚**：所有规则启用操作包裹在单一事务中，失败时完整回滚（含版本冲突检测）：
   - 切换 `is_active`、写 `RULE_ACTIVATION_LOG`、写 `RULE_ROLLBACK_PACKAGE` 三者原子一致
   - 激活校验失败（描述冲突+阈值不一致）：拒绝启用，不写任何脏数据
   - 导入即生效时激活失败：反向删除刚导入的规则，返回 `imported=[]`
7. **预演过期并发检测**：预演确认时检查锚点规则是否仍为当前生效版本，若已被其他人修改，提示"预演已过期"，拒绝执行
8. **回退包导入冲突校验**：`/api/rules/rollback-packages/apply` 先校验版本号是否与 DB 冲突，冲突返回 **HTTP 400 + 明确错误信息**（不会抛 500），不切换不写日志
