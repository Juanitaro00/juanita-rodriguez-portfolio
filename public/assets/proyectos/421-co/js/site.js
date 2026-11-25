(() => {
  'use strict';

  const rootPath = (path) => path;
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  const notify = (message) => {
    let toast = document.querySelector('.site-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'site-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  };

  const repairEmptyLinks = () => {
    const destinations = {
      'nosotros': 'index.html#nosotros',
      'comunidad': 'index.html#comunidad',
      'contacto': 'contacto_.html',
      'faq': 'contacto_.html#formulario',
      'pqrs': 'contacto_.html#formulario',
      'eventos': 'index.html#comunidad',
      'noticias': 'index.html#novedades',
      'cupones': 'productos.html',
      'confianza': 'productos.html#cafes',
      'politica de privacidad': 'contacto_.html#formulario',
      'terminos y condiciones': 'contacto_.html#formulario',
      'base de datos': 'contacto_.html#formulario',
      'mapa del sitio': 'index.html'
    };
    document.querySelectorAll('a[href=""]').forEach((link) => {
      const label = normalize(link.textContent.trim());
      link.href = rootPath(destinations[label] || 'index.html');
    });
  };

  const setupNavigation = () => {
    const toggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.respmenu');
    if (!toggle || !nav) return;
    const close = () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir menú');
    };
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    });
    nav.querySelectorAll('.cont-center a').forEach((link) => link.addEventListener('click', close));
    document.addEventListener('keydown', (event) => event.key === 'Escape' && close());
  };

  const getCart = () => {
    try { return JSON.parse(localStorage.getItem('421-cart')) || []; }
    catch { return []; }
  };
  const saveCart = (items) => localStorage.setItem('421-cart', JSON.stringify(items));

  const setupCart = () => {
    const panel = document.createElement('aside');
    panel.className = 'cart-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '<div class="cart-panel__head"><h2>Tu carrito</h2><button type="button" class="cart-close" aria-label="Cerrar carrito">×</button></div><div class="cart-items"></div><div class="cart-total"></div>';
    document.body.append(panel);

    const render = () => {
      const items = getCart();
      const list = panel.querySelector('.cart-items');
      const total = panel.querySelector('.cart-total');
      list.innerHTML = items.length ? items.map((item, index) => `<div class="cart-item"><div><strong>${item.name}</strong><span>${item.quantity} × ${money.format(item.price)}</span></div><button type="button" data-remove-cart="${index}" aria-label="Eliminar ${item.name}">×</button></div>`).join('') : '<p class="cart-empty">Tu carrito está vacío.</p>';
      total.textContent = items.length ? `Total: ${money.format(items.reduce((sum, item) => sum + item.price * item.quantity, 0))}` : '';
      document.querySelectorAll('.cart-toggle').forEach((button) => {
        button.dataset.count = String(items.reduce((sum, item) => sum + item.quantity, 0));
      });
    };
    const open = () => {
      render();
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      panel.querySelector('.cart-close').focus();
    };
    const close = () => {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
    };
    document.querySelectorAll('.cart-toggle').forEach((button) => button.addEventListener('click', open));
    panel.querySelector('.cart-close').addEventListener('click', close);
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-cart]');
      if (!button) return;
      const items = getCart();
      items.splice(Number(button.dataset.removeCart), 1);
      saveCart(items);
      render();
    });
    document.addEventListener('keydown', (event) => event.key === 'Escape' && close());

    let quantity = 1;
    const quantityOutput = document.querySelector('[data-quantity-value]');
    document.querySelectorAll('[data-quantity]').forEach((button) => button.addEventListener('click', () => {
      quantity = button.dataset.quantity === 'increase' ? Math.min(quantity + 1, 20) : Math.max(quantity - 1, 1);
      if (quantityOutput) quantityOutput.textContent = String(quantity);
    }));
    document.querySelectorAll('[data-add-cart]').forEach((button) => button.addEventListener('click', () => {
      const items = getCart();
      const name = button.dataset.addCart;
      const existing = items.find((item) => item.name === name);
      if (existing) existing.quantity += quantity;
      else items.push({ name, price: Number(button.dataset.price), quantity });
      saveCart(items);
      render();
      notify(`${name} fue agregado al carrito.`);
    }));
    render();
  };

  const setupProductGallery = () => {
    const main = document.querySelector('.corajecafe-producto');
    const thumbs = document.querySelectorAll('.MiniaturaCoraje');
    if (!main || !thumbs.length) return;
    thumbs.forEach((thumb) => {
      thumb.tabIndex = 0;
      thumb.setAttribute('role', 'button');
      const select = () => {
        const previous = main.src;
        main.src = thumb.src;
        thumb.src = previous;
        thumbs.forEach((item) => item.classList.toggle('is-selected', item === thumb));
      };
      thumb.addEventListener('click', select);
      thumb.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
      });
    });
  };

  const setupSearch = () => {
    const input = document.querySelector('.busqueda-input');
    if (!input) return;
    const cards = [...document.querySelectorAll('.cafegrid, .merchgrid2, .merchgrid2-partedos')];
    const filter = () => {
      const query = normalize(input.value.trim());
      cards.forEach((card) => card.hidden = Boolean(query) && !normalize(card.textContent).includes(query));
    };
    input.addEventListener('input', filter);
    document.querySelector('.lupa')?.addEventListener('click', filter);
  };

  const setStatus = (container, message, error = false) => {
    const status = container.querySelector('.form-status') || document.createElement('p');
    status.className = `form-status${error ? ' is-error' : ''}`;
    status.setAttribute('role', 'status');
    status.textContent = message;
    if (!status.isConnected) container.append(status);
  };

  const setupForms = () => {
    document.querySelector('.formulario-contacto form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      setStatus(event.currentTarget, 'Mensaje preparado correctamente. Esta versión de muestra no está conectada a un servicio de correo.');
    });

    const login = document.querySelector('.boton-iniciar');
    login?.addEventListener('click', () => {
      const container = login.closest('.iniciar-sesion');
      const user = container.querySelector('#usuario').value.trim();
      const password = container.querySelector('#contrasena').value;
      if (!user || !password) return setStatus(container, 'Completa usuario y contraseña.', true);
      sessionStorage.setItem('421-session', user);
      setStatus(container, `Sesión local iniciada para ${user}.`);
    });

    const register = document.querySelector('.boton-registrar');
    register?.addEventListener('click', () => {
      const container = register.closest('.registrar');
      const name = container.querySelector('#nombreCompleto').value.trim();
      const email = container.querySelector('#email').value.trim();
      const password = container.querySelector('#contrasena').value;
      const confirmation = container.querySelector('#confirmarContrasena').value;
      if (!name || !email || !password || !confirmation) return setStatus(container, 'Completa todos los campos requeridos.', true);
      if (password !== confirmation) return setStatus(container, 'Las contraseñas no coinciden.', true);
      localStorage.setItem('421-demo-user', JSON.stringify({ name, email }));
      setStatus(container, 'Registro local completado. Ya puedes iniciar sesión.');
    });

    document.querySelectorAll('.boton-footer').forEach((button) => button.addEventListener('click', () => {
      const input = button.closest('.input-container')?.querySelector('input[type="email"]');
      if (!input || !input.value.trim() || !input.checkValidity()) {
        input?.focus();
        return notify('Escribe un correo válido para suscribirte.');
      }
      notify('Suscripción registrada en esta demostración.');
      input.value = '';
    }));
  };

  const setupUtilities = () => {
    document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => {
      const destination = button.dataset.go;
      if (destination.startsWith('#')) document.querySelector(destination)?.scrollIntoView({ behavior: 'smooth' });
      else window.location.href = destination;
    }));
    document.querySelectorAll('.whatsapp-fija, .whatsapp-fija-c').forEach((element) => {
      if (element.querySelector('a')) return;
      element.tabIndex = 0;
      element.setAttribute('role', 'link');
      element.setAttribute('aria-label', 'Abrir WhatsApp');
      const open = () => window.open('https://wa.me/573008263196', '_blank', 'noopener');
      element.addEventListener('click', open);
      element.addEventListener('keydown', (event) => event.key === 'Enter' && open());
    });
    document.querySelector('.boton-escucha')?.addEventListener('click', () => notify('El enlace original de Spotify no está incluido en los archivos del proyecto.'));
    document.querySelector('.olvidar')?.addEventListener('click', () => notify('La recuperación de contraseña requiere conexión con un servicio de autenticación.'));

    const access = document.querySelector('.accessibility-toggle');
    if (localStorage.getItem('421-accessibility') === 'true') document.body.classList.add('accessibility-mode');
    access?.addEventListener('click', () => {
      const active = document.body.classList.toggle('accessibility-mode');
      localStorage.setItem('421-accessibility', String(active));
      notify(active ? 'Modo de alto contraste activado.' : 'Modo de alto contraste desactivado.');
    });
  };

  repairEmptyLinks();
  setupNavigation();
  setupCart();
  setupProductGallery();
  setupSearch();
  setupForms();
  setupUtilities();
})();
