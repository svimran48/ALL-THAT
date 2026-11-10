const form = document.getElementById('form');
const msg = document.getElementById('msg');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  submit.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    if (res.ok) {
      location.href = '/';
      return;
    }
    const data = await res.json().catch(() => ({}));
    msg.textContent = data.error || `Sign-in failed (${res.status}).`;
  } catch {
    msg.textContent = 'Could not reach the hub. Check your connection and try again.';
  } finally {
    submit.disabled = false;
  }
});
