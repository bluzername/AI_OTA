(function(){
  const STRINGS = {
    en: {
      city: 'City', startDate: 'Start Date', endDate: 'End Date', interests: 'Interests',
      'interest.culture': 'Culture', 'interest.food': 'Food', 'interest.nature': 'Nature', 'interest.shopping': 'Shopping', 'interest.kids': 'Kids',
      pace: 'Pace', 'pace.easy': 'Easy', 'pace.balanced': 'Balanced', 'pace.packed': 'Packed',
      budget: 'Budget', 'budget.low': 'Low', 'budget.mid': 'Mid', 'budget.high': 'High',
      generate: 'Generate Itinerary', reset: 'Reset', book: 'Book', exportJson: 'Export JSON', exportIcs: 'Export ICS',
      disclaimer: 'Data is sample only. Walking times are estimates.', day: 'Day', flights: 'Flights', stays: 'Stays'
    },
    he: {
      city: 'עיר', startDate: 'תאריך התחלה', endDate: 'תאריך סיום', interests: 'תחומי עניין',
      'interest.culture': 'תרבות', 'interest.food': 'אוכל', 'interest.nature': 'טבע', 'interest.shopping': 'קניות', 'interest.kids': 'ילדים',
      pace: 'קצב', 'pace.easy': 'קל', 'pace.balanced': 'מאוזן', 'pace.packed': 'צפוף',
      budget: 'תקציב', 'budget.low': 'נמוך', 'budget.mid': 'בינוני', 'budget.high': 'גבוה',
      generate: 'בנה מסלול', reset: 'איפוס', book: 'הזמנה', exportJson: 'ייצוא JSON', exportIcs: 'ייצוא ICS',
      disclaimer: 'הנתונים לדוגמה בלבד. זמני ההליכה משוערים.', day: 'יום', flights: 'טיסות', stays: 'לינה'
    }
  };

  function applyLocale(locale){
    const dict = STRINGS[locale] || STRINGS.en;
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
    const toggle = document.getElementById('localeToggle');
    if (toggle) toggle.textContent = locale === 'he' ? 'EN' : 'HE';
  }

  function initLocale(){
    const saved = localStorage.getItem('locale') || 'en';
    applyLocale(saved);
    const toggle = document.getElementById('localeToggle');
    toggle?.addEventListener('click', () => {
      const curr = document.documentElement.getAttribute('lang') || 'en';
      const next = curr === 'en' ? 'he' : 'en';
      localStorage.setItem('locale', next);
      applyLocale(next);
    });
  }

  window.I18N = { applyLocale };
  document.addEventListener('DOMContentLoaded', initLocale);
})();