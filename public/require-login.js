/* Bloqueia toda a navegação do app até o usuário fazer login — não existe mais
   modo "visitante". Some com o conteúdo e força a tela de login assim que a
   página carrega. Quando o login é concluído, recarrega a página pra
   renderizar tudo normalmente (igual já acontecia pra admin/supervisor). */
(function () {
  function hasToken() {
    try { return !!localStorage.getItem('pcm_token'); } catch (e) { return false; }
  }

  if (hasToken()) return; // já logado, não faz nada

  function hideAppContent() {
    ['tabbar', 'homeGrid'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  function forceLoginModal() {
    var openBtn = document.getElementById('loginOpenBtn');
    var overlay = document.getElementById('loginModalOverlay');
    if (openBtn) openBtn.click();
    if (overlay) overlay.classList.remove('hidden');
  }

  function run() {
    hideAppContent();
    forceLoginModal();
  }

  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);

  var t = setInterval(function () {
    if (hasToken()) {
      clearInterval(t);
      window.location.reload();
      return;
    }
    run();
  }, 500);
})();
