/**
 * CoCreate AI - Scheduler JavaScript
 * Handles calendar navigation, slot fetching, and booking submission
 *
 * Usage:
 *   const scheduler = new Scheduler();
 *   // Auto-initializes on DOMContentLoaded
 */

(function(window) {
  'use strict';

  class Scheduler {
    constructor() {
      // State management
      this.state = {
        currentMonth: this.getCurrentMonth(),
        selectedDate: null,
        selectedTime: null,
        userTimezone: this.detectTimezone(),
        slotsCache: {},
        loading: false,
        error: null,
        userData: {
          name: '',
          email: '',
          productIdea: '',
          notes: ''
        }
      };

      // DOM element references (populated in cacheElements)
      this.elements = {};

      // Initialize
      this.init();
    }

    /**
     * Get current month as { year, month }
     */
    getCurrentMonth() {
      const now = new Date();
      return {
        year: now.getFullYear(),
        month: now.getMonth() // 0-indexed
      };
    }

    /**
     * Detect user timezone using Intl API
     */
    detectTimezone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch (e) {
        console.warn('[Scheduler] Failed to detect timezone:', e);
        return 'UTC';
      }
    }

    /**
     * Initialize the scheduler
     */
    init() {
      this.parseUrlParams();
      this.cacheElements();
      this.bindEvents();
      this.render();
      this.fetchSlots(this.state.currentMonth.year, this.state.currentMonth.month);
    }

    /**
     * Parse URL parameters for pre-filled form data
     */
    parseUrlParams() {
      const params = new URLSearchParams(window.location.search);

      if (params.has('name')) {
        this.state.userData.name = decodeURIComponent(params.get('name'));
      }
      if (params.has('email')) {
        this.state.userData.email = decodeURIComponent(params.get('email'));
      }
      if (params.has('idea')) {
        this.state.userData.productIdea = decodeURIComponent(params.get('idea'));
      }

      console.log('[Scheduler] Parsed URL params:', this.state.userData);
    }

    /**
     * Cache DOM element references for performance
     */
    cacheElements() {
      this.elements = {
        // Calendar
        calendarGrid: document.getElementById('calendar-grid'),
        calendarMonth: document.getElementById('calendar-month'),
        prevMonthBtn: document.getElementById('prev-month'),
        nextMonthBtn: document.getElementById('next-month'),

        // Time slots
        timeslotsContainer: document.getElementById('timeslots-container'),
        timeslotsSection: document.getElementById('timeslots-section'),
        timeslotsDate: document.getElementById('timeslots-date'),
        timezoneSelect: document.getElementById('timezone-select'),

        // Form
        nameInput: document.getElementById('scheduler-name'),
        emailInput: document.getElementById('scheduler-email'),
        ideaInput: document.getElementById('scheduler-idea'),
        notesInput: document.getElementById('scheduler-notes'),
        submitBtn: document.getElementById('submit-booking'),

        // Containers
        schedulerContainer: document.getElementById('scheduler-container'),
        confirmationContainer: document.getElementById('confirmation-container'),
        loadingOverlay: document.getElementById('loading-overlay'),
        errorMessage: document.getElementById('error-message'),

        // Confirmation elements
        confirmationDate: document.getElementById('confirmation-date'),
        confirmationTime: document.getElementById('confirmation-time'),
        confirmationTimezone: document.getElementById('confirmation-timezone'),
        meetLink: document.getElementById('meet-link'),
        copyLinkBtn: document.getElementById('copy-link-btn'),
        goHomeBtn: document.getElementById('go-home-btn')
      };
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
      // Calendar navigation
      if (this.elements.prevMonthBtn) {
        this.elements.prevMonthBtn.addEventListener('click', () => this.navigateMonth(-1));
      }
      if (this.elements.nextMonthBtn) {
        this.elements.nextMonthBtn.addEventListener('click', () => this.navigateMonth(1));
      }

      // Form inputs - update state and validate
      if (this.elements.nameInput) {
        this.elements.nameInput.addEventListener('input', (e) => {
          this.state.userData.name = e.target.value;
          this.updateSubmitButton();
        });
      }
      if (this.elements.emailInput) {
        this.elements.emailInput.addEventListener('input', (e) => {
          this.state.userData.email = e.target.value;
          this.updateSubmitButton();
        });
      }
      if (this.elements.ideaInput) {
        this.elements.ideaInput.addEventListener('input', (e) => {
          this.state.userData.productIdea = e.target.value;
          this.updateSubmitButton();
        });
      }
      if (this.elements.notesInput) {
        this.elements.notesInput.addEventListener('input', (e) => {
          this.state.userData.notes = e.target.value;
        });
      }

      // Timezone select
      if (this.elements.timezoneSelect) {
        // Set initial value to detected timezone
        this.elements.timezoneSelect.value = this.state.userTimezone;

        this.elements.timezoneSelect.addEventListener('change', (e) => {
          this.state.userTimezone = e.target.value;
          // Re-render with new timezone (times may display differently)
          this.render();
        });
      }

      // Submit button
      if (this.elements.submitBtn) {
        this.elements.submitBtn.addEventListener('click', () => this.submitBooking());
      }

      // Confirmation actions
      if (this.elements.copyLinkBtn) {
        this.elements.copyLinkBtn.addEventListener('click', () => this.copyMeetLink());
      }
      if (this.elements.goHomeBtn) {
        this.elements.goHomeBtn.addEventListener('click', () => this.goHome());
      }
    }

    /**
     * Navigate between months
     * @param {number} delta - +1 for next month, -1 for previous
     */
    navigateMonth(delta) {
      const { year, month } = this.state.currentMonth;
      let newMonth = month + delta;
      let newYear = year;

      if (newMonth > 11) {
        newMonth = 0;
        newYear++;
      } else if (newMonth < 0) {
        newMonth = 11;
        newYear--;
      }

      // Don't allow navigating to past months
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      if (newYear < currentYear || (newYear === currentYear && newMonth < currentMonth)) {
        return; // Don't navigate to past
      }

      this.state.currentMonth = { year: newYear, month: newMonth };
      this.state.selectedDate = null;
      this.state.selectedTime = null;

      this.render();
      this.fetchSlots(newYear, newMonth);
    }

    /**
     * Fetch available slots from API
     * @param {number} year
     * @param {number} month - 0-indexed
     */
    async fetchSlots(year, month) {
      const cacheKey = `${year}-${String(month + 1).padStart(2, '0')}`;

      // Check cache first
      if (this.state.slotsCache[cacheKey]) {
        console.log('[Scheduler] Using cached slots for', cacheKey);
        this.render();
        return;
      }

      this.showLoading(true);
      this.state.error = null;

      try {
        const apiUrl = this.getApiUrl('schedulerSlots');
        const url = `${apiUrl}?year=${year}&month=${month + 1}&timezone=${encodeURIComponent(this.state.userTimezone)}`;

        console.log('[Scheduler] Fetching slots:', url);

        const response = await fetch(url);
        const data = await response.json();

        if (data.success && data.slots) {
          this.state.slotsCache[cacheKey] = data.slots;
          console.log('[Scheduler] Fetched', Object.keys(data.slots).length, 'days with slots');
        } else {
          throw new Error(data.error || 'Failed to fetch slots');
        }
      } catch (error) {
        console.error('[Scheduler] Error fetching slots:', error);
        this.state.error = 'Unable to load available times. Please try again.';
      } finally {
        this.showLoading(false);
        this.render();
      }
    }

    /**
     * Get API URL from AppConfig
     * @param {string} endpoint
     */
    getApiUrl(endpoint) {
      if (window.AppConfig && window.AppConfig.api && window.AppConfig.api[endpoint]) {
        return window.AppConfig.api[endpoint];
      }
      // Fallback
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const base = isLocal
        ? 'http://localhost:5000'
        : 'https://bx0ywfkona.execute-api.ap-south-1.amazonaws.com/prod';

      const endpoints = {
        schedulerSlots: `${base}/scheduler/slots`,
        schedulerBook: `${base}/scheduler/book`
      };
      return endpoints[endpoint] || '';
    }

    /**
     * Master render method - calls all sub-renders
     */
    render() {
      this.renderCalendar();
      this.renderTimeSlots();
      this.renderForm();
      this.renderError();
      this.updateSubmitButton();
    }

    /**
     * Render the calendar grid
     */
    renderCalendar() {
      if (!this.elements.calendarGrid || !this.elements.calendarMonth) return;

      const { year, month } = this.state.currentMonth;
      const cacheKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      const slots = this.state.slotsCache[cacheKey] || {};

      // Update month display
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      this.elements.calendarMonth.textContent = `${monthNames[month]} ${year}`;

      // Build calendar grid
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let html = '';

      // Day headers
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dayNames.forEach(day => {
        html += `<div class="calendar-day-header">${day}</div>`;
      });

      // Empty cells before first day
      for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="calendar-day empty"></div>';
      }

      // Days of month
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);

        const isPast = date < today;
        const isToday = date.getTime() === today.getTime();
        const isSelected = this.state.selectedDate === dateStr;
        const hasSlots = slots[dateStr] && slots[dateStr].length > 0;

        let classes = ['calendar-day'];
        if (isPast) {
          classes.push('disabled');
        } else if (hasSlots) {
          classes.push('available');
        } else {
          classes.push('disabled');
        }
        if (isToday) classes.push('today');
        if (isSelected) classes.push('selected');

        const clickHandler = !isPast && hasSlots ? `onclick="window.scheduler.selectDate('${dateStr}')"` : '';

        html += `<div class="${classes.join(' ')}" ${clickHandler}>${day}</div>`;
      }

      this.elements.calendarGrid.innerHTML = html;

      // Update prev/next button states
      const now = new Date();
      const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
      if (this.elements.prevMonthBtn) {
        this.elements.prevMonthBtn.disabled = isCurrentMonth;
      }
    }

    /**
     * Render time slots for selected date
     */
    renderTimeSlots() {
      if (!this.elements.timeslotsContainer || !this.elements.timeslotsDate) return;

      if (!this.state.selectedDate) {
        this.elements.timeslotsDate.textContent = 'Select a date';
        this.elements.timeslotsContainer.innerHTML = '<div class="timeslots-empty">Please select a date to view available times</div>';
        return;
      }

      // Parse date for display
      const [year, month, day] = this.state.selectedDate.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      this.elements.timeslotsDate.textContent = date.toLocaleDateString('en-US', options);

      // Get slots for this date
      const cacheKey = `${year}-${String(month).padStart(2, '0')}`;
      const monthSlots = this.state.slotsCache[cacheKey] || {};
      const daySlots = monthSlots[this.state.selectedDate] || [];

      if (daySlots.length === 0) {
        this.elements.timeslotsContainer.innerHTML = '<div class="timeslots-empty">No available times for this date</div>';
        return;
      }

      let html = '';
      daySlots.forEach(slot => {
        const time = slot.time || slot;
        const isSelected = this.state.selectedTime === time;
        const displayTime = this.formatTime(time);

        html += `<div class="timeslot${isSelected ? ' selected' : ''}" onclick="window.scheduler.selectTime('${time}')">${displayTime}</div>`;
      });

      this.elements.timeslotsContainer.innerHTML = html;
    }

    /**
     * Render form with pre-filled values
     */
    renderForm() {
      if (this.elements.nameInput && this.state.userData.name && !this.elements.nameInput.value) {
        this.elements.nameInput.value = this.state.userData.name;
      }
      if (this.elements.emailInput && this.state.userData.email && !this.elements.emailInput.value) {
        this.elements.emailInput.value = this.state.userData.email;
      }
      if (this.elements.ideaInput && this.state.userData.productIdea && !this.elements.ideaInput.value) {
        this.elements.ideaInput.value = this.state.userData.productIdea;
      }
      if (this.elements.notesInput && this.state.userData.notes && !this.elements.notesInput.value) {
        this.elements.notesInput.value = this.state.userData.notes;
      }
    }

    /**
     * Render error message if present
     */
    renderError() {
      if (!this.elements.errorMessage) return;

      if (this.state.error) {
        this.elements.errorMessage.textContent = this.state.error;
        this.elements.errorMessage.classList.remove('hidden');
      } else {
        this.elements.errorMessage.classList.add('hidden');
      }
    }

    /**
     * Handle date selection
     * @param {string} dateStr - YYYY-MM-DD format
     */
    selectDate(dateStr) {
      console.log('[Scheduler] Selected date:', dateStr);
      this.state.selectedDate = dateStr;
      this.state.selectedTime = null;
      this.render();
    }

    /**
     * Handle time slot selection
     * @param {string} time - HH:MM format
     */
    selectTime(time) {
      console.log('[Scheduler] Selected time:', time);
      this.state.selectedTime = time;
      this.render();
    }

    /**
     * Format time from 24h to 12h format
     * @param {string} time - HH:MM format (e.g., "09:00")
     * @returns {string} - 12h format (e.g., "9:00 AM")
     */
    formatTime(time) {
      if (!time) return '';

      const [hours, minutes] = time.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;

      return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
    }

    /**
     * Update submit button enabled/disabled state
     */
    updateSubmitButton() {
      if (!this.elements.submitBtn) return;

      const isValid = this.isFormValid();
      this.elements.submitBtn.disabled = !isValid;
    }

    /**
     * Check if form is valid for submission
     */
    isFormValid() {
      const name = this.elements.nameInput?.value.trim() || this.state.userData.name;
      const email = this.elements.emailInput?.value.trim() || this.state.userData.email;
      const idea = this.elements.ideaInput?.value.trim() || this.state.userData.productIdea;

      return (
        this.state.selectedDate &&
        this.state.selectedTime &&
        name.length > 0 &&
        this.isValidEmail(email) &&
        idea.length > 0
      );
    }

    /**
     * Validate email format
     * @param {string} email
     * @returns {boolean}
     */
    isValidEmail(email) {
      if (!email) return false;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    }

    /**
     * Show/hide loading overlay
     * @param {boolean} show
     */
    showLoading(show) {
      this.state.loading = show;
      if (this.elements.loadingOverlay) {
        if (show) {
          this.elements.loadingOverlay.classList.remove('hidden');
        } else {
          this.elements.loadingOverlay.classList.add('hidden');
        }
      }
    }

    /**
     * Submit booking to API
     */
    async submitBooking() {
      if (!this.isFormValid()) {
        this.state.error = 'Please fill in all required fields';
        this.renderError();
        return;
      }

      this.showLoading(true);
      this.state.error = null;

      try {
        const apiUrl = this.getApiUrl('schedulerBook');

        const bookingData = {
          date: this.state.selectedDate,
          time: this.state.selectedTime,
          timezone: this.state.userTimezone,
          name: this.elements.nameInput?.value.trim() || this.state.userData.name,
          email: this.elements.emailInput?.value.trim() || this.state.userData.email,
          productIdea: this.elements.ideaInput?.value.trim() || this.state.userData.productIdea,
          notes: this.elements.notesInput?.value.trim() || this.state.userData.notes || ''
        };

        console.log('[Scheduler] Submitting booking:', bookingData);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bookingData)
        });

        const data = await response.json();

        if (data.success) {
          console.log('[Scheduler] Booking successful:', data);
          this.showConfirmation(data.booking || data);
        } else {
          throw new Error(data.error || 'Failed to book appointment');
        }
      } catch (error) {
        console.error('[Scheduler] Booking error:', error);
        this.state.error = error.message || 'Unable to book appointment. Please try again.';
        this.renderError();
      } finally {
        this.showLoading(false);
      }
    }

    /**
     * Show confirmation UI after successful booking
     * @param {object} booking - Booking details from API
     */
    showConfirmation(booking) {
      console.log('[Scheduler] Showing confirmation:', booking);

      // Hide scheduler, show confirmation
      if (this.elements.schedulerContainer) {
        this.elements.schedulerContainer.classList.add('hidden');
      }
      if (this.elements.confirmationContainer) {
        this.elements.confirmationContainer.classList.remove('hidden');
      }

      // Populate confirmation details
      if (this.elements.confirmationDate) {
        const [year, month, day] = this.state.selectedDate.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        this.elements.confirmationDate.textContent = date.toLocaleDateString('en-US', options);
      }

      if (this.elements.confirmationTime) {
        this.elements.confirmationTime.textContent = this.formatTime(this.state.selectedTime);
      }

      if (this.elements.confirmationTimezone) {
        this.elements.confirmationTimezone.textContent = this.state.userTimezone;
      }

      if (this.elements.meetLink && booking.meetLink) {
        this.elements.meetLink.href = booking.meetLink;
        this.elements.meetLink.textContent = booking.meetLink;
      }
    }

    /**
     * Copy meet link to clipboard
     */
    async copyMeetLink() {
      const link = this.elements.meetLink?.href;
      if (!link) return;

      try {
        await navigator.clipboard.writeText(link);

        // Visual feedback
        const btn = this.elements.copyLinkBtn;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      } catch (error) {
        console.error('[Scheduler] Failed to copy link:', error);
      }
    }

    /**
     * Navigate back to home page
     */
    goHome() {
      window.location.href = 'index.html';
    }
  }

  // Initialize when DOM is ready
  function initScheduler() {
    if (document.getElementById('calendar-grid')) {
      window.scheduler = new Scheduler();
      console.log('[Scheduler] Initialized');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScheduler);
  } else {
    initScheduler();
  }

  // Export to window
  window.Scheduler = Scheduler;

})(window);
