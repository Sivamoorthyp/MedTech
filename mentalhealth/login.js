document.addEventListener('DOMContentLoaded', () => {
    // Modal Elements
    const loginModal = document.getElementById('loginModal');
    const openLoginBtn = document.getElementById('openLoginBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // Tab Elements
    const roleTabs = document.querySelectorAll('.role-tab');
    const roleForms = document.querySelectorAll('.role-form');

    // 1. Modal Open / Close Logic
    const openModal = () => {
        loginModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    };

    const closeModal = () => {
        loginModal.classList.remove('active');
        document.body.style.overflow = '';
        resetAllForms();
    };

    openLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });

    closeModalBtn.addEventListener('click', closeModal);

    // Close when clicking outside the modal content
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            closeModal();
        }
    });

    // 2. Tab Switching Logic
    roleTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and forms
            roleTabs.forEach(t => t.classList.remove('active'));
            roleForms.forEach(f => f.classList.remove('active'));

            // Add active class to clicked tab
            tab.classList.add('active');

            // Show corresponding form
            const targetRole = tab.getAttribute('data-role');
            const targetForm = document.getElementById(`${targetRole}Form`);
            if (targetForm) {
                targetForm.classList.add('active');
            }

            resetAllForms();
        });
    });

    // 3. Form Validation & Submission
    const handleFormSubmit = (e) => {
        e.preventDefault();
        const form = e.target;
        let isValid = true;

        // Clear previous errors
        const formGroups = form.querySelectorAll('.form-group');
        formGroups.forEach(group => group.classList.remove('error'));

        // Basic validation: Check required and minlength
        const inputs = form.querySelectorAll('input');
        inputs.forEach(input => {
            if (input.required && !input.value.trim()) {
                isValid = false;
                input.closest('.form-group').classList.add('error');
            } else if (input.type === 'password' && input.value.length < 6) {
                isValid = false;
                input.closest('.form-group').classList.add('error');
            }
        });

        if (isValid) {
            simulateLogin(form);
        }
    };

    // Attach submit listener to all forms
    roleForms.forEach(form => {
        form.addEventListener('submit', handleFormSubmit);

        // Clear error on input
        const inputs = form.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                input.closest('.form-group').classList.remove('error');
            });
        });
    });

    // 4. Login Simulation
    const simulateLogin = (form) => {
        // Get the active role to know where to redirect
        const activeTab = document.querySelector('.role-tab.active');
        const role = activeTab.getAttribute('data-role');

        const submitBtn = form.querySelector('.submit-btn');

        // Show loading state
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        // Simulate network request
        setTimeout(() => {
            // Reset state (in case user comes back)
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            // Redirect based on role
            window.location.href = `/${role}.html`;
        }, 1500);
    };

    // Helper: Reset forms when closing modal or switching tabs
    const resetAllForms = () => {
        roleForms.forEach(form => {
            form.reset();
            const formGroups = form.querySelectorAll('.form-group');
            formGroups.forEach(group => group.classList.remove('error'));

            const submitBtn = form.querySelector('.submit-btn');
            if (submitBtn) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            }
        });
    };
});
