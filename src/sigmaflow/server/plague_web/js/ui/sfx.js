/* Plague Inc web — SFX layer (原作 97 条音频, 本页接线 8 条核心)
 * 数据来源: APK assets/*.wav (阶段0提取, 未转码)
 * 音量分级: 事件音 0.55 / 终局音 0.8; 总开关浮动按钮(默认开)
 */
(function (root) {
  var VOL = { buttonclick: 0.4, buttonclose: 0.4, aapickup: 0.5, aasuccess: 0.5,
              siren: 0.35, start_pop: 0.6, lastbreath: 0.8, aafail: 0.8 };
  var pool = {};
  var enabled = true;
  var lastPlay = {};
  function el(name) {
    if (!pool[name]) { pool[name] = new Audio('assets/audio/' + name + '.wav'); }
    return pool[name];
  }
  function play(name) {
    if (!enabled) return;
    try {
      var now = Date.now();
      if (lastPlay[name] && now - lastPlay[name] < 90) return; // 防抖
      lastPlay[name] = now;
      var a = el(name);
      a.volume = VOL[name] || 0.5;
      a.currentTime = 0;
      a.play().catch(function () {});
    } catch (e) {}
  }
  var SFX = { play: play,
    setEnabled: function (v) { enabled = !!v; btn.textContent = enabled ? '🔊' : '🔇'; btn.title = enabled ? '音效开' : '音效关'; },
    get enabled() { return enabled; } };
  root.SFX = SFX;
  // 浮动开关
  var btn = document.createElement('button');
  btn.style.cssText = 'position:fixed;top:10px;right:12px;z-index:9999;background:rgba(30,20,24,.75);color:#eee;border:1px solid #7a3038;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:15px';
  btn.onclick = function () { SFX.setEnabled(!enabled); if (enabled) play('buttonclick'); };
  btn.textContent = '🔊'; btn.title = '音效开';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(btn); });
})(window);
