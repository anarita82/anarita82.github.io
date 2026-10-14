const menuButton = document.querySelector(".menu-button");
const navMenu = document.querySelector(".nav-menu");
const header = document.querySelector("[data-header]");
const year = document.querySelector("#year");
const navLinks = Array.from(document.querySelectorAll(".nav-menu a"));
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if (year) {
  year.textContent = new Date().getFullYear();
}

function closeMenu() {
  document.body.classList.remove("menu-open");
  navMenu?.classList.remove("is-open");
  menuButton?.setAttribute("aria-expanded", "false");
}

menuButton?.addEventListener("click", () => {
  const isOpen = navMenu.classList.toggle("is-open");
  document.body.classList.toggle("menu-open", isOpen);
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

navMenu?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    closeMenu();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
  }
});

function updateHeaderState() {
  header?.classList.toggle("is-scrolled", window.scrollY > 12);
}

function updateActiveNav() {
  const visibleSections = sections.filter((section) => section.getBoundingClientRect().top <= 120);
  const currentSection = visibleSections[visibleSections.length - 1];

  if (!currentSection) {
    return;
  }

  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${currentSection.id}`);
  });
}

updateHeaderState();
updateActiveNav();

window.addEventListener("scroll", () => {
  updateHeaderState();
  updateActiveNav();
}, { passive: true });

window.addEventListener("resize", () => {
  if (window.innerWidth > 980) {
    closeMenu();
  }
});
