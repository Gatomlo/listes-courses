// Tags des plats : saisie libre sur le plat, gestion depuis le foyer (renommer, fusionner, supprimer).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const tagsOf = async (name) => (await thomas.get(`${h}/dishes`)).data.find((d) => d.name === name).tags;
const tag = async (name) => (await thomas.get(`${h}/tags`)).data.find((t) => t.name === name);

test('tags : saisie, doublons, renommer, fusionner, supprimer, droits', async () => {
  const a = (await thomas.post(`${h}/dishes`, { name: 'Chili', tags: ['Rapide', ' rapide ', 'Végé', ''] })).data;
  assert.deepEqual(a.tags, ['Rapide', 'Végé']);
  const b = (await thomas.post(`${h}/dishes`, { name: 'Soupe', tags: ['RAPIDE', 'Hiver', 'Végétarien'] })).data;
  assert.deepEqual(b.tags, ['Hiver', 'Rapide', 'Végétarien']);
  assert.equal((await thomas.get(`${h}/tags`)).data.filter((t) => !t.auto).length, 4);
  assert.equal((await tag('Rapide')).dishes, 2);

  // Fusion « Végé » -> « Végétarien »
  const vege = await tag('Végé'), vegetarien = await tag('Végétarien');
  assert.equal((await lea.post(`${h}/tags/${vege.id}/merge`, { into: vegetarien.id })).status, 403);
  await thomas.post(`${h}/tags/${vege.id}/merge`, { into: vegetarien.id });
  assert.deepEqual(await tagsOf('Chili'), ['Rapide', 'Végétarien']);
  assert.equal((await tag('Végétarien')).dishes, 2);

  // Renommer vers un nom existant = fusion ; renommer simple
  const hiver = await tag('Hiver');
  await thomas.patch(`${h}/tags/${hiver.id}`, { name: 'rapide' });
  assert.deepEqual(await tagsOf('Soupe'), ['Rapide', 'Végétarien']);
  await thomas.patch(`${h}/tags/${(await tag('Rapide')).id}`, { name: 'Express' });
  assert.deepEqual(await tagsOf('Chili'), ['Express', 'Végétarien']);

  // Suppression
  await thomas.del(`${h}/tags/${(await tag('Express')).id}`);
  assert.deepEqual(await tagsOf('Chili'), ['Végétarien']);
  // Enregistrer sans « tags » ne touche pas aux tags
  await thomas.put(`${h}/dishes/${a.id}`, { name: 'Chili con carne' });
  assert.deepEqual(await tagsOf('Chili con carne'), ['Végétarien']);
});
