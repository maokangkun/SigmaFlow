/* 消息完成提示音: 内嵌 base64, 避免对外的运行时请求; 音源 assets/done.mp3(tukuppt 预览音效, 9.2 KB)。
   再生成: python3 -c "import base64,pathlib;print(...)" 更新下面常量即可。 */
window.CS = window.CS || {};
CS.audio = (function () {
  let audio = null;  // 惰性创建: 避免页面加载即解码音频, 也让浏览器自动播放策略更容易放行
  function ensure() {
    if (!audio) {
      audio = new Audio('data:audio/mpeg;base64,${b}');
      audio.volume = 0.55;
    }
    return audio;
  }
  // 回复完成时提示; 失败静默(无手势环境/浏览器拦截时不出声即可, 不打扰)
  function playDone() {
    try {
      const a = ensure();
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 无 Audio 支持时忽略 */ }
  }
  return { playDone };
})();
