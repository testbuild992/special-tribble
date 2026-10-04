import './env.js';
import app, { seedAdmin } from './app.js';

const PORT = Number(process.env.PORT || 3000);

seedAdmin()
  .catch((e) => console.error('Admin seed failed:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`BIJI running on http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin | Staff panel: http://localhost:${PORT}/staff`);
    });
  });
