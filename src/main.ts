#!/usr/bin/env node
// ============================================================
// Nodus (结绳) — AI-Native OS for Developers
// 入口点
// ============================================================

import { NodusShell } from './shell/nodus-shell.js';
import { JsonConfigManager } from './common/config.js';

const PROJECTS = process.argv.slice(2);

async function main() {
  const configManager = new JsonConfigManager();
  const initialConfig = configManager.get();

  // 命令行传入的项目路径覆盖配置文件
  if (PROJECTS.length > 0) {
    initialConfig.projectPaths = PROJECTS;
    configManager.set('projectPaths', PROJECTS);
  }

  const shell = new NodusShell(configManager);

  await shell.bootstrap();

  // REPL: stdin loop (works for both TTY and pipe)
  if (!process.stdin.isTTY) {
    console.log('\nNodus is ready.\n');
  } else {
    console.log('\nNodus is ready. Type a query or /quit to exit.\n');
  }

  // 记录最近一次推荐，用于序号执行
  let lastRecommendations: Array<{ text: string; reason: string }> = [];

  process.stdin.setEncoding('utf-8');
  for await (const line of readLines(process.stdin)) {
    const input = line.trim();
    if (!input) {
      // 空行 → 显示推荐
      lastRecommendations = shell.getRecommendationList();
      const output = shell.getRecommendations();
      console.log(output);
      continue;
    }

    // 数字序号 → 执行对应推荐
    if (/^\d+$/.test(input) && lastRecommendations.length > 0) {
      const idx = parseInt(input, 10) - 1;
      if (idx >= 0 && idx < lastRecommendations.length) {
        const recText = lastRecommendations[idx]!.text;
        console.log(`> ${recText}`);
        const output = await shell.handleQueryFormatted(recText);
        console.log(output);
        continue;
      }
    }

    // 推荐已被消费，清空
    lastRecommendations = [];

    // /history 命令
    if (input === '/history' || input.startsWith('/history ')) {
      const parts = input.split(/\s+/);
      const limit = parts[1] ? Math.min(parseInt(parts[1], 10) || 10, 50) : 10;
      const output = shell.getHistory(limit);
      console.log(output);
      continue;
    }

    // /learn 命令 — 重新加载反馈数据
    if (input === '/learn') {
      const count = shell.learnFeedback();
      const total = shell.getLearnedCount();
      if (count > 0) {
        console.log(`已从反馈数据中学习 ${count} 条新句式（共 ${total} 条）。`);
      } else {
        console.log(`没有新的反馈数据可学习（当前已有 ${total} 条学习句式）。`);
      }
      continue;
    }

    // /help 命令 — 显示可用命令
    if (input === '/help') {
      console.log(`
可用命令：
  /help                显示本帮助
  /list                列出所有可调用的查询能力
  /history [n]         查看最近 n 条查询历史（默认 10，最大 50）
  /learn               重新加载 feedback.jsonl 学习例句
  /feedback <文本>     提交使用反馈
  /switch <项目路径>   切换到指定项目
  /list-projects       列出所有已配置项目
  /sync                导出同步数据（JSON）
  /confirm <符号>      确认符号已审查（债值清零）
  /prune [标签]        删除过时约定（无参数则列出约定）
  /quit 或 /exit       退出 Nodus

直接输入自然语言即可查询，例如：
  refundOrder在哪里定义的
  PaymentService被哪些地方调用了
  项目代码统计
  AI 最近改到哪儿了
  查看 src/main.ts
  chunk 1 简报
  确认 refundOrder 已审查
  列出约定
  重构 refundOrder 为 async
  解析这个错误日志
  导出项目索引
  给 refundOrder 添加注释
`);
      continue;
    }

    // /list 命令 — 列出可调用的查询能力
    if (input === '/list') {
      console.log(`
可调用的查询能力：

  代码理解
    定义定位        refundOrder在哪里定义的
    引用查找        PaymentService被哪些地方调用了
    调用链路        refundOrder的调用链路是什么样的
    影响分析        如果我改了User模型，哪些文件会受影响
    文件概览        payment.service.ts里有哪些函数
    类型关系        谁实现了 IUserService

  代码分析
    代码统计        项目代码统计
    最热函数        调用次数最多的函数
    死代码检测      有哪些未使用的导出
    变更热点        变更热点文件
    模块耦合        模块耦合度
    最长调用链      最长调用链
    TODO 扫描       项目里有哪些 TODO

  历史与评审
    变更历史        auth模块最近一周改了什么
    代码评审        评审 commit abc1234

  代码生成与重构
    重构符号        重构 refundOrder 为 async
    提取函数        提取验证逻辑为新函数
    生成 diff       生成 payment.ts 的 diff
    改进建议        给出代码改进建议

  跨域调试
    解析日志        解析这个错误日志
    trace error     trace this error

  团队协作
    导出索引        导出项目索引
    导入索引        导入共享索引
    添加注释        给 refundOrder 添加注释
    导出团队知识    导出团队知识

  项目管理
    切换项目        切换到 /path/to/project
    列出项目        /list-projects
    查询历史        /history

  理解层（人与 AI 代码产出对齐）
    最近变更        AI 最近改到哪儿了
    带标注视图      查看 src/main.ts
    语义块简报      chunk 1 简报
    确认审查        确认 refundOrder 已审查
    列出约定        列出约定

  其他
    推荐查询        直接按回车
    手动反馈        /feedback 查询结果不够准确
    多设备同步      /sync
`);
      continue;
    }

    // /feedback 命令 — 提交手动反馈
    if (input.startsWith('/feedback ')) {
      const text = input.slice('/feedback '.length).trim();
      if (text) {
        shell.recordManualFeedback(text);
        console.log('反馈已记录，谢谢。');
      } else {
        console.log('请提供反馈内容，例如：/feedback 查询结果不够准确');
      }
      continue;
    }

    // /switch 命令 — 切换项目
    if (input.startsWith('/switch ')) {
      const projectPath = input.slice('/switch '.length).trim();
      if (projectPath) {
        try {
          await shell.switchProject(projectPath);
          console.log(`已切换到项目: ${projectPath}`);
        } catch (err) {
          console.error('切换项目失败:', err instanceof Error ? err.message : String(err));
        }
      } else {
        console.log('请提供项目路径，例如：/switch /path/to/project');
      }
      continue;
    }

    // /list-projects 命令 — 列出项目
    if (input === '/list-projects') {
      console.log(shell.getProjectList());
      continue;
    }

    // /sync 命令 — 导出同步数据
    if (input === '/sync') {
      try {
        const data = shell.exportSyncData();
        console.log(JSON.stringify(data, null, 2));
      } catch (err) {
        console.error('导出同步数据失败:', err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // /confirm <symbol> 命令
    if (input.startsWith('/confirm ')) {
      const symbol = input.slice('/confirm '.length).trim();
      if (symbol) {
        const output = await shell.handleQueryFormatted(`/confirm ${symbol}`);
        console.log(output);
      }
      continue;
    }

    // /prune [tag] 命令
    if (input === '/prune' || input.startsWith('/prune ')) {
      const tag = input.startsWith('/prune ') ? input.slice('/prune '.length).trim() : '';
      const output = await shell.handleQueryFormatted(tag ? `/prune ${tag}` : '列出约定');
      console.log(output);
      continue;
    }

    if (input === '/quit' || input === '/exit') break;

    try {
      const output = await shell.handleQueryFormatted(input);
      console.log(output);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  await shell.shutdown();
}

async function* readLines(stream: NodeJS.ReadStream): AsyncGenerator<string> {
  let remainder = '';
  for await (const chunk of stream) {
    const text = remainder + (chunk as string);
    const lines = text.split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) yield line;
  }
  if (remainder) yield remainder;
}

main().catch(console.error);
