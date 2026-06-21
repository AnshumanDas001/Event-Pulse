/* Event Plan Optima — theme toggle.
   The actual dark/light values live in style.css as CSS variables; this
   script only flips the `data-theme` attribute, persists the choice, swaps
   the moon/sun icon, and announces the change so app.js can re-theme the
   two things CSS can't reach on its own: Chart.js canvases and the
   Leaflet basemap tiles. */

(function () {
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function applyIcon(theme) {
    const moon = document.querySelector("#themeToggle .icon-moon");
    const sun = document.querySelector("#themeToggle .icon-sun");
    const btn = document.getElementById("themeToggle");
    if (!moon || !sun || !btn) return;
    if (theme === "light") {
      moon.style.display = "none";
      sun.style.display = "block";
      btn.setAttribute("aria-label", "Switch to dark mode");
      btn.setAttribute("title", "Switch to dark mode");
    } else {
      moon.style.display = "block";
      sun.style.display = "none";
      btn.setAttribute("aria-label", "Switch to light mode");
      btn.setAttribute("title", "Switch to light mode");
    }
  }

  function setTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try { localStorage.setItem("eventpulse-theme", theme); } catch (e) { /* ignore */ }
    applyIcon(theme);
    window.dispatchEvent(new CustomEvent("eventpulse:themechange", { detail: { theme } }));
  }

  window.EventPulseTheme = { current: currentTheme, set: setTheme };

  document.addEventListener("DOMContentLoaded", function () {
    applyIcon(currentTheme());
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.addEventListener("click", function () {
        setTheme(currentTheme() === "light" ? "dark" : "light");
      });
    }
  });
})();
