const counterValue = document.getElementById('counter-value');
const incrementBtn = document.getElementById('increment-btn');

if (counterValue && incrementBtn) {
  incrementBtn.addEventListener('click', () => {
    const current = Number(counterValue.textContent ?? '0');
    counterValue.textContent = String(current + 1);
  });
}

const apiBtn = document.getElementById('api-btn');
const apiResponse = document.getElementById('api-response');

if (apiBtn && apiResponse) {
  apiBtn.addEventListener('click', async () => {
    const [error, data] = await tryCatch(request('/api/ping'));

    if (error) apiResponse.textContent = String(error);
    else apiResponse.textContent = JSON.stringify(data, null, 2);

    console.log(data);
  });
}
