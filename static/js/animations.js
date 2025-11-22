/**
 * Дополнительные анимации и эффекты для Nebula Chat
 */

document.addEventListener('DOMContentLoaded', () => {
  // Плавное появление элементов при прокрутке
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Наблюдаем за сообщениями
  const messages = document.querySelectorAll('.message');
  messages.forEach(msg => {
    msg.style.opacity = '0';
    msg.style.transform = 'translateY(20px)';
    msg.style.transition = 'opacity 0.4s, transform 0.4s';
    observer.observe(msg);
  });

  // Эффект ripple для кнопок
  function createRipple(event) {
    const button = event.currentTarget;
    const ripple = document.createElement('span');
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.classList.add('ripple-effect');

    const existingRipple = button.querySelector('.ripple-effect');
    if (existingRipple) {
      existingRipple.remove();
    }

    button.appendChild(ripple);

    setTimeout(() => ripple.remove(), 600);
  }

  // Добавляем ripple эффект к кнопкам
  const buttons = document.querySelectorAll('button, .btn, .action-btn');
  buttons.forEach(button => {
    button.style.position = 'relative';
    button.style.overflow = 'hidden';
    button.addEventListener('click', createRipple);
  });

  // Параллакс эффект для фона
  let mouseX = 0;
  let mouseY = 0;
  let currentX = 0;
  let currentY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 20;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 20;
  });

  function animateParallax() {
    currentX += (mouseX - currentX) * 0.1;
    currentY += (mouseY - currentY) * 0.1;

    const body = document.body;
    if (body) {
      body.style.backgroundPosition = `${50 + currentX}% ${50 + currentY}%`;
    }

    requestAnimationFrame(animateParallax);
  }

  animateParallax();

  // Плавная прокрутка для сообщений
  const messagesContainer = document.getElementById('messages');
  if (messagesContainer) {
    const smoothScroll = () => {
      messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: 'smooth'
      });
    };

    // Наблюдаем за добавлением новых сообщений
    const messageObserver = new MutationObserver(smoothScroll);
    messageObserver.observe(messagesContainer, {
      childList: true
    });
  }

  // Добавляем эффект свечения при фокусе на input
  const inputs = document.querySelectorAll('input[type="text"], input[type="password"], textarea');
  inputs.forEach(input => {
    input.addEventListener('focus', function() {
      this.parentElement?.classList.add('input-focused');
    });

    input.addEventListener('blur', function() {
      this.parentElement?.classList.remove('input-focused');
    });
  });

  // Анимация для flash сообщений
  const flashMessages = document.querySelectorAll('.flash-message');
  flashMessages.forEach((msg, index) => {
    msg.style.animationDelay = `${index * 0.1}s`;
  });
});

// CSS для ripple эффекта (добавляется динамически)
const style = document.createElement('style');
style.textContent = `
  .ripple-effect {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    transform: scale(0);
    animation: ripple-animation 0.6s ease-out;
    pointer-events: none;
  }

  @keyframes ripple-animation {
    to {
      transform: scale(4);
      opacity: 0;
    }
  }

  .input-focused {
    animation: input-glow 0.3s ease-out;
  }

  @keyframes input-glow {
    0% {
      filter: drop-shadow(0 0 0 transparent);
    }
    50% {
      filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));
    }
    100% {
      filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.2));
    }
  }
`;
document.head.appendChild(style);
