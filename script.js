function openModal(element) {
    const hiddenContent = element.querySelector('.hidden-content');
    if (!hiddenContent) return;

    const title = hiddenContent.querySelector('.h-title').innerHTML;
    const desc = hiddenContent.querySelector('.h-desc').innerHTML;
    const mediaHTML = hiddenContent.querySelector('.h-media').innerHTML;

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="modal-title">${title}</div>
        <div class="modal-desc">${desc}</div>
        <div class="modal-media-list">${mediaHTML}</div>
    `;

    document.getElementById('modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(event) {
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = 'auto';
    
    const modalBody = document.getElementById('modalBody');
    const videos = modalBody.querySelectorAll('video');
    videos.forEach(v => v.pause());
}

document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('header, section'); 
    const navLinks = document.querySelectorAll('.nav-item');

    window.addEventListener('scroll', () => {
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            if (scrollY >= (sectionTop - 200)) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href').includes(current)) {
                link.classList.add('active');
            }
        });
    });
});

document.addEventListener('contextmenu', function(e) {
    if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') {
        e.preventDefault();
    }
});