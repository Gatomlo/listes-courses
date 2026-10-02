// Secours : definit le mot de passe d'un compte depuis le serveur (sans e-mail ni lien).
// Usage : npm run set-password -- <email> <mot de passe>
// (CABAS_DATA_DIR pour une autre base que data/.)
const { db } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

(async () => {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage : npm run set-password -- <email> <mot de passe>');
    process.exit(1);
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) { console.error(`Aucun compte pour ${email}.`); process.exit(1); }
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  } catch (e) { console.error(e.message); process.exit(1); }
  console.log(`Mot de passe de ${email} mis à jour.`);
})();
