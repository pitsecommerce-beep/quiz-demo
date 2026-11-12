(function () {
  "use strict";

  /* ---------- Configuración ---------- */

  var cfg = window.QUIZ_CONFIG || {};
  var params = new URLSearchParams(window.location.search);
  var REQUEST_TIMEOUT_MS = 12000;
  var LOW_TIME_S = 5;
  var BLOQUES = ["T", "CLF", "AIF"];

  function resolveApiUrl() {
    var override = params.get("api");
    var candidate = override || cfg.API_URL || "";
    try {
      var u = new URL(candidate, window.location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return "";
      return u.href;
    } catch (e) {
      return "";
    }
  }

  var API_URL = resolveApiUrl();
  var API_KEY = typeof cfg.API_KEY === "string" ? cfg.API_KEY : "";
  var apiNotConfigured = !params.get("api") && /REEMPLAZA/.test(String(cfg.API_URL || ""));

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  function motionOk() { return !(reduceMotion && reduceMotion.matches); }

  /* ---------- Utilidades DOM (solo textContent) ---------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------- Alias anónimo ---------- */

  var ALIAS_KEY = "quiz.alias";
  var ALIAS_RE = /^[a-z]{3,12}-[a-z]{3,12}-\d{2}$/;
  var ANIMALES = [
    "zorro", "lobo", "ajolote", "jaguar", "quetzal", "tlacuache", "coyote",
    "puma", "ocelote", "venado", "tortuga", "ballena", "nutria", "garza",
    "iguana", "gato", "oso", "mapache", "cenzontle", "lince", "armadillo",
    "cuervo", "foca", "teporingo", "berrendo", "tapir", "zorrillo"
  ];
  var ADJETIVOS = [
    "azul", "verde", "gris", "veloz", "feliz", "audaz", "tenaz", "alegre",
    "valiente", "brillante", "amable", "noble", "fuerte", "libre", "sagaz",
    "leal", "jovial", "celeste", "turquesa", "cordial", "genial", "capaz",
    "dulce", "grande", "elegante", "constante"
  ];

  function randInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function newAlias() {
    var n = String(randInt(100));
    if (n.length < 2) n = "0" + n;
    return ANIMALES[randInt(ANIMALES.length)] + "-" + ADJETIVOS[randInt(ADJETIVOS.length)] + "-" + n;
  }

  function getAlias() {
    var stored = null;
    try { stored = window.localStorage.getItem(ALIAS_KEY); } catch (e) { stored = null; }
    if (stored && ALIAS_RE.test(stored)) return stored;
    var alias = newAlias();
    try { window.localStorage.setItem(ALIAS_KEY, alias); } catch (e) { /* sin almacenamiento: sigue funcionando */ }
    return alias;
  }

  /* ---------- Preguntas ---------- */

  function validQuestion(q) {
    return q && typeof q === "object" &&
      typeof q.id === "string" && q.id.length > 0 &&
      BLOQUES.indexOf(q.bloque) !== -1 &&
      typeof q.q === "string" && q.q.length > 0 &&
      Array.isArray(q.a) && q.a.length === 4 &&
      q.a.every(function (x) { return typeof x === "string" && x.length > 0; }) &&
      typeof q.t === "number" && isFinite(q.t) && q.t > 0;
  }

  function parseRangeParam(name) {
    var raw = params.get(name);
    if (raw == null || !/^\d+$/.test(raw)) return null;
    return parseInt(raw, 10);
  }

  function sliceRange(list) {
    var desde = parseRangeParam("desde");
    var hasta = parseRangeParam("hasta");
    var start = Math.max(1, desde || 1);
    var end = Math.min(list.length, hasta || list.length);
    if (start > end) return list;
    return list.slice(start - 1, end);
  }

  function loadQuestions() {
    return fetch("questions.json", { cache: "no-cache", credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("http");
        return r.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error("formato");
        // Solo se conservan los campos que se muestran.
        var clean = data.filter(validQuestion).map(function (q) {
          return { id: q.id, bloque: q.bloque, q: q.q, a: q.a.slice(), t: Math.round(q.t) };
        });
        if (!clean.length) throw new Error("vacio");
        return sliceRange(clean);
      });
  }

  /* ---------- Estado ---------- */

  var state = {
    alias: getAlias(),
    questions: [],
    index: 0,
    locked: false,
    chosen: 0,
    timerId: null,
    deadline: 0,
    lowAnnounced: false,
    stats: { aciertos: 0, errores: 0, cola: 0, sinRegistro: 0 }
  };

  var screens = ["loading", "intro", "question", "final", "error"];

  function show(name) {
    screens.forEach(function (s) { $("screen-" + s).hidden = s !== name; });
    var card = $("card");
    if (motionOk()) {
      card.style.animation = "none";
      void card.offsetWidth;
      card.style.animation = "";
    }
  }

  /* ---------- Temporizador ---------- */

  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function stopTimer() {
    if (state.timerId) window.clearInterval(state.timerId);
    state.timerId = null;
    $("timer").classList.add("is-stopped");
  }

  function tick() {
    var left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    var t = $("timer");
    t.textContent = fmt(left);
    t.classList.toggle("is-low", left <= LOW_TIME_S && left > 0);
    if (left <= LOW_TIME_S && left > 0 && !state.lowAnnounced) {
      state.lowAnnounced = true;
      $("timer-live").textContent = "Quedan " + left + " segundos.";
    }
    if (left === 0) {
      stopTimer();
      onTimeout();
    }
  }

  function startTimer(seconds) {
    stopTimer();
    state.lowAnnounced = false;
    $("timer-live").textContent = "";
    $("timer").classList.remove("is-stopped", "is-low");
    state.deadline = Date.now() + seconds * 1000;
    tick();
    state.timerId = window.setInterval(tick, 250);
  }

  /* ---------- Render de pregunta ---------- */

  function optionButtons() {
    return Array.prototype.slice.call($("options").querySelectorAll(".option"));
  }

  function setProgress(done) {
    var total = state.questions.length;
    $("progress-fill").style.transform = "scaleX(" + (total ? done / total : 0) + ")";
    var bar = $("progress");
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(done));
    bar.setAttribute("aria-valuetext", done + " de " + total + " respondidas");
  }

  function renderQuestion() {
    var q = state.questions[state.index];
    var total = state.questions.length;
    state.locked = false;
    state.chosen = 0;

    $("counter").textContent = "Pregunta " + (state.index + 1) + " de " + total;
    $("bloque").textContent = q.bloque;
    $("q-text").textContent = q.q;
    setProgress(state.index);

    var box = $("options");
    clear(box);
    q.a.forEach(function (text, i) {
      var b = el("button", "option");
      b.type = "button";
      b.dataset.opcion = String(i + 1);
      b.setAttribute("aria-keyshortcuts", String(i + 1));
      b.appendChild(el("span", "option-key", i + 1)).setAttribute("aria-hidden", "true");
      b.appendChild(el("span", "option-text", text));
      b.appendChild(el("span", "option-status"));
      b.addEventListener("click", function () { choose(i + 1); });
      box.appendChild(b);
    });

    clear($("result"));
    $("retry").hidden = true;
    $("next").hidden = true;
    $("next").textContent = state.index + 1 < total ? "Siguiente" : "Ver resultados";

    startTimer(q.t);
    $("q-text").focus({ preventScroll: true });
  }

  function transitionTo(fn) {
    var body = $("q-body");
    if (!motionOk()) { fn(); return; }
    body.classList.remove("is-entering");
    body.classList.add("is-leaving");
    window.setTimeout(function () {
      fn();
      body.classList.remove("is-leaving");
      void body.offsetWidth;
      body.classList.add("is-entering");
    }, 160);
  }

  /* ---------- Resultado ---------- */

  var ICONS = { ok: "✓", bad: "✕", warn: "!", info: "i" };

  function showResult(kind, title, lines) {
    var r = $("result");
    clear(r);
    r.className = "result is-" + kind;
    var head = el("p", "result-head");
    head.appendChild(el("span", "result-icon", ICONS[kind])).setAttribute("aria-hidden", "true");
    head.appendChild(el("span", null, title));
    r.appendChild(head);
    (lines || []).forEach(function (line) {
      if (line) r.appendChild(el("p", "result-body", line));
    });
  }

  function setStatus(btn, text) {
    btn.querySelector(".option-status").textContent = text;
  }

  function lockOptions() {
    state.locked = true;
    optionButtons().forEach(function (b) { b.disabled = true; });
  }

  function finishQuestion(canRetry) {
    $("retry").hidden = !canRetry;
    var next = $("next");
    next.hidden = false;
    setProgress(state.index + 1);
    next.focus({ preventScroll: true });
  }

  function onTimeout() {
    if (state.locked) return;
    lockOptions();
    state.stats.sinRegistro++;
    showResult("warn", "Se acabó el tiempo", ["Esta pregunta no se envió. Continúa con la siguiente."]);
    finishQuestion(false);
  }

  /* ---------- Envío ---------- */

  function choose(opcion) {
    if (state.locked || $("screen-question").hidden) return;
    stopTimer();
    lockOptions();
    state.chosen = opcion;
    var btn = optionButtons()[opcion - 1];
    btn.classList.add("is-selected");
    setStatus(btn, "Enviando…");
    send();
  }

  function send() {
    var q = state.questions[state.index];
    var btn = optionButtons()[state.chosen - 1];
    $("retry").hidden = true;
    $("next").hidden = true;
    showResult("info", "Enviando tu respuesta…", []);
    setStatus(btn, "Enviando…");

    if (!API_URL || apiNotConfigured) {
      handleOutcome({ kind: "config" });
      return;
    }

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = window.setTimeout(function () { if (controller) controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch(API_URL, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ pregunta_id: q.id, opcion: state.chosen, alias: state.alias }),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          return { kind: "http", status: res.status, data: data };
        });
      }, function () {
        return { kind: "network" };
      })
      .then(function (outcome) {
        window.clearTimeout(timeout);
        handleOutcome(outcome);
      });
  }

  function serverError(data) {
    if (data && typeof data.error === "string" && data.error.trim()) return data.error.trim().slice(0, 300);
    return "";
  }

  function handleOutcome(o) {
    var btn = optionButtons()[state.chosen - 1];
    var retryable = false;

    if (o.kind === "config") {
      setStatus(btn, "No enviada");
      showResult("bad", "El quiz no está configurado", ["Falta la dirección de la API. Avisa a tu docente."]);
      retryable = false;
      state.stats.sinRegistro++;
    } else if (o.kind === "network") {
      setStatus(btn, "Sin enviar");
      showResult("warn", "No hay conexión con el servidor", ["Revisa tu conexión a internet e intenta de nuevo."]);
      retryable = true;
    } else if (o.status === 200) {
      var d = o.data || {};
      var correcta = typeof d.correcta === "number" ? d.correcta : parseInt(d.correcta, 10);
      if (typeof d.acierto !== "boolean" || !(correcta >= 1 && correcta <= 4)) {
        setStatus(btn, "Registrada");
        showResult("warn", "Respuesta registrada", ["El servidor respondió con un formato inesperado, así que no podemos mostrar el resultado."]);
        state.stats.cola++;
      } else {
        var expl = typeof d.explicacion === "string" ? d.explicacion : "";
        var good = optionButtons()[correcta - 1];
        if (d.acierto) {
          state.stats.aciertos++;
          btn.classList.remove("is-selected");
          btn.classList.add("is-correct");
          setStatus(btn, "✓ Correcta");
          showResult("ok", "¡Correcto!", [expl]);
        } else {
          state.stats.errores++;
          btn.classList.remove("is-selected");
          btn.classList.add("is-wrong");
          setStatus(btn, "✕ Tu respuesta");
          good.classList.add("is-correct");
          setStatus(good, "✓ Correcta");
          showResult("bad", "Incorrecto. La respuesta correcta es la opción " + correcta + ".", [expl]);
        }
      }
    } else if (o.status === 202) {
      state.stats.cola++;
      setStatus(btn, "En cola");
      showResult("info", "Respuesta recibida", ["Quedó en cola y se registrará en breve. Puedes continuar."]);
    } else if (o.status === 400) {
      state.stats.sinRegistro++;
      setStatus(btn, "Rechazada");
      showResult("bad", "No se pudo registrar tu respuesta", [serverError(o.data) || "La solicitud no es válida.", "Continúa con la siguiente pregunta."]);
    } else if (o.status === 401 || o.status === 403) {
      state.stats.sinRegistro++;
      setStatus(btn, "No enviada");
      showResult("bad", "Acceso denegado", ["La llave de acceso del quiz no es válida. Avisa a tu docente."]);
    } else if (o.status === 409) {
      state.stats.sinRegistro++;
      setStatus(btn, "Ya respondida");
      showResult("warn", "Ya habías respondido esta pregunta", ["Solo se toma en cuenta tu primera respuesta."]);
    } else if (o.status === 429) {
      setStatus(btn, "Sin enviar");
      showResult("warn", "Demasiadas solicitudes", ["Espera unos segundos y vuelve a intentar."]);
      retryable = true;
    } else {
      setStatus(btn, "Sin enviar");
      showResult("bad", "El servidor tuvo un problema", ["Código " + o.status + ". Intenta de nuevo en un momento."]);
      retryable = o.status >= 500;
      if (!retryable) state.stats.sinRegistro++;
    }

    finishQuestion(retryable);
    if (retryable) $("retry").focus({ preventScroll: true });
  }

  /* ---------- Navegación ---------- */

  function next() {
    // Si quedó pendiente un reintento, se cuenta como no registrada.
    if (!$("retry").hidden) state.stats.sinRegistro++;
    if (state.index + 1 >= state.questions.length) {
      showFinal();
      return;
    }
    state.index++;
    transitionTo(renderQuestion);
  }

  function showFinal() {
    stopTimer();
    var s = state.stats;
    var total = state.questions.length;
    $("score-num").textContent = String(s.aciertos);
    $("score-of").textContent = "de " + total + " aciertos";
    $("final-alias").textContent = state.alias;

    var ratio = total ? s.aciertos / total : 0;
    var msg;
    if (ratio >= 0.9) msg = "Excelente trabajo. Dominas el tema.";
    else if (ratio >= 0.7) msg = "Muy bien. Repasa las explicaciones de las que fallaste.";
    else if (ratio >= 0.5) msg = "Vas por buen camino. Un repaso más y lo tienes.";
    else msg = "Buen intento. Revisa las explicaciones y vuelve a estudiar estos temas.";
    if (s.cola > 0) msg += " Algunas respuestas siguen en proceso y no aparecen en el conteo.";
    $("final-msg").textContent = msg;

    var list = $("breakdown");
    clear(list);
    [["Correctas", s.aciertos], ["Incorrectas", s.errores], ["En proceso", s.cola], ["Sin registrar", s.sinRegistro]]
      .forEach(function (row) {
        if (row[0] !== "Correctas" && row[0] !== "Incorrectas" && row[1] === 0) return;
        var li = el("li");
        li.appendChild(el("span", null, row[0]));
        li.appendChild(el("strong", null, row[1]));
        list.appendChild(li);
      });

    show("final");
    var fill = $("score-fill");
    fill.style.transform = "scaleX(0)";
    void fill.offsetWidth;
    fill.style.transform = "scaleX(" + ratio + ")";
    $("final-title").focus({ preventScroll: true });
  }

  function showError(msg) {
    $("error-msg").textContent = msg;
    show("error");
    $("error-title").focus({ preventScroll: true });
  }

  /* ---------- Teclado ---------- */

  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if ($("screen-question").hidden) return;
    if (/^[1-4]$/.test(e.key) && !state.locked) {
      e.preventDefault();
      choose(parseInt(e.key, 10));
      return;
    }
    if (e.key === "Enter" && !$("next").hidden) {
      var a = document.activeElement;
      if (a && a.tagName === "BUTTON") return; // el botón enfocado ya maneja Enter
      e.preventDefault();
      next();
    }
  });

  /* ---------- Arranque ---------- */

  $("start").addEventListener("click", function () {
    state.index = 0;
    show("question");
    renderQuestion();
  });
  $("next").addEventListener("click", next);
  $("retry").addEventListener("click", function () {
    if (state.chosen) send();
  });
  $("reload").addEventListener("click", function () { window.location.reload(); });

  $("alias-value").textContent = state.alias;
  $("alias-box").hidden = false;

  loadQuestions().then(function (qs) {
    state.questions = qs;
    var mins = Math.ceil(qs.reduce(function (acc, q) { return acc + q.t; }, 0) / 60);
    $("intro-count").textContent = "Son " + qs.length + (qs.length === 1 ? " pregunta" : " preguntas") +
      " y te tomará como máximo " + mins + (mins === 1 ? " minuto." : " minutos.");
    if (apiNotConfigured) {
      $("intro-warn").textContent = "Aviso: la dirección de la API aún no está configurada, así que las respuestas no se podrán enviar.";
      $("intro-warn").hidden = false;
    }
    show("intro");
    $("start").focus({ preventScroll: true });
  }).catch(function () {
    var local = window.location.protocol === "file:";
    showError(local
      ? "Abre la página desde un servidor web (por ejemplo, python -m http.server), no directamente desde el archivo."
      : "No pudimos cargar las preguntas. Revisa tu conexión e intenta de nuevo.");
  });
})();
