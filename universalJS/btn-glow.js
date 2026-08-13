document.addEventListener('DOMContentLoaded', () => {
  // Performance optimization: Check if the device hardware supports a standard pointer mouse
  const hasMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!hasMouse) return; // Exit script entirely on phone/tablet to save battery processing

  const aiButtons = document.querySelectorAll('.btn');

  aiButtons.forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
      
      btn.style.setProperty('--mouse-x', `${xPercent}%`);
      btn.style.setProperty('--mouse-y', `${yPercent}%`);
    });

    btn.style.setProperty('--mouse-x', '50%');
    btn.style.setProperty('--mouse-y', '50%');
    
    btn.addEventListener('mouseleave', () => {
      btn.style.setProperty('--mouse-x', '50%');
      btn.style.setProperty('--mouse-y', '50%');
    });
  });
});
