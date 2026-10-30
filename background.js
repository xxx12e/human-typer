chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('无法启用侧边栏：', error));

importScripts('i18n.js', 'sanitize.js', 'thinking.js', 'docs-runner.js');
