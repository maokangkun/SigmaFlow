# SigmaFlow 服务器文档

### 启动服务
```bash
sigmaflow --serve -d /mnt/workspace/code/github/SigmaFlow/example
```

API说明
```bash
# 查看 pipeline 列表
curl localhost:55159/api/list/pipeline

# 查看 prompt 列表
curl localhost:55159/api/list/prompt

# 查看 task 队列
curl localhost:55159/task

# 查看当前任务信息
curl localhost:55159/cur_task

# 取消任务
curl localhost:55159/cancel_task/523eaa45-f28d-4989-93e0-e0852adc62d0
```

使用`wscat`测试api
```bash
# 安装 wscat
npm install -g wscat

wscat -c 0.0.0.0:55159/ws
# or
wscat -c "0.0.0.0:55159/ws?sid=b3886c0813184569a53f33f598c8f8ea"

# > {"task": [{"pipe": "demo_pipeline", "data": {"患者信息": "xxx"}}]}
```

