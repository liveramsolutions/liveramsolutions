document.addEventListener('DOMContentLoaded', () => {
  const starsContainer = document.querySelector('.stars');
  
  // Safety check to prevent errors on pages without the starry background container
  if (!starsContainer) return;

  function createStar() {
    const star = document.createElement('div');
    star.classList.add('star');

    star.style.top = Math.random() * 100 + "%";
    star.style.left = Math.random() * 100 + "%";

    const size = Math.random() * 3 + 2;
    star.style.width = size + "px";
    star.style.height = size + "px";

    const colors = ["#ffffff", "#ffe066", "#99ccff", "#ff99ff", "#aaffaa"];
    const chosenColor = colors[Math.floor(Math.random() * colors.length)];
    star.style.background = chosenColor;
    star.style.color = chosenColor;

    const duration = Math.random() * 5 + 3;
    const delay = Math.random() * 5;
    star.style.animationDuration = duration + "s";
    star.style.animationDelay = delay + "s";

    starsContainer.appendChild(star);

    setTimeout(() => {
      star.remove();
    }, (duration + delay) * 1000);
  }

  setInterval(createStar, 200);
});
