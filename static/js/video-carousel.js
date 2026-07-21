document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-video-carousel]').forEach((carousel) => {
        const slides = Array.from(carousel.querySelectorAll('.video-carousel-slide'));
        const dots = Array.from(carousel.querySelectorAll('.video-carousel-dot'));
        const previousButton = carousel.querySelector('.video-carousel-previous');
        const nextButton = carousel.querySelector('.video-carousel-next');
        let activeIndex = 0;
        let isVisible = false;

        const playActiveVideo = () => {
            if (!isVisible) return;
            const video = slides[activeIndex].querySelector('video');
            video.play().catch(() => {
                // Browsers may still require direct interaction before autoplaying.
            });
        };

        const showSlide = (index) => {
            const nextIndex = (index + slides.length) % slides.length;

            slides.forEach((slide, slideIndex) => {
                const isActive = slideIndex === nextIndex;
                const video = slide.querySelector('video');
                slide.hidden = !isActive;
                slide.classList.toggle('is-active', isActive);
                video.pause();
                if (!isActive) video.currentTime = 0;
            });

            dots.forEach((dot, dotIndex) => {
                const isActive = dotIndex === nextIndex;
                dot.classList.toggle('is-active', isActive);
                if (isActive) {
                    dot.setAttribute('aria-current', 'true');
                } else {
                    dot.removeAttribute('aria-current');
                }
            });

            activeIndex = nextIndex;
            playActiveVideo();
        };

        previousButton.addEventListener('click', () => showSlide(activeIndex - 1));
        nextButton.addEventListener('click', () => showSlide(activeIndex + 1));
        dots.forEach((dot, index) => dot.addEventListener('click', () => showSlide(index)));

        carousel.addEventListener('keydown', (event) => {
            if (event.target !== carousel) return;

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                showSlide(activeIndex - 1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                showSlide(activeIndex + 1);
            }
        });

        const observer = new IntersectionObserver((entries) => {
            isVisible = entries[0].isIntersecting;
            if (isVisible) {
                playActiveVideo();
            } else {
                slides[activeIndex].querySelector('video').pause();
            }
        }, { threshold: 0.35 });

        observer.observe(carousel);
    });
});
