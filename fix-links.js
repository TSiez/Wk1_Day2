
// Link fix script for TesterTech.html
// Replace href="#" links with proper page links
(function() {
  if (!document.querySelector('section#featured')) return; // Only run on TesterTech
  const links = Array.from(document.querySelectorAll('a[href="#"]'));
  const targets = [
    'index.html#features', // Spec sheet
    'anything.html',        // Hear it
    'lens01.html',          // Read the file (Lens 01)
    'loopring.html',        // Read the file (Loop Ring)
    'echofield.html',       // Explore Echo Field
    'reserve.html',         // Reserve the family
    'bench.html',           // Berlin Bench
    'press.html',           // Press
    'privacy.html',         // Privacy Ledger
    'service.html',         // Service
    'index.html#contact',   // Contact
    'reserve.html'          // Reserve
  ];
  let count = 0;
  links.forEach(a => {
    if (count < 12) {
      a.href = targets[count];
      count++;
    }
  });
})();
