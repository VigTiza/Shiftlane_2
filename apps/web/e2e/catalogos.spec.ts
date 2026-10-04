import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNT_FILE } from './global-setup';

interface Account {
  email: string;
  password: string;
  tenantName: string;
  vehiclesXlsx: string;
}

const account = JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8')) as Account;
const stamp = Date.now().toString().slice(-5);

// Los pasos dependen uno del otro (la misma cuenta va avanzando) y comparten la sesión: se
// entra una sola vez, como un usuario real (la API limita los intentos de acceso).
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await page.close();
});

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo').fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Mi cuenta' })).toBeVisible();
}

test('asistente: datos de la empresa y avance', async () => {
  await page.goto('/');
  await expect(page.getByText('Configura tu cuenta para empezar a operar')).toBeVisible();
  await expect(page.getByText('0 de 8 pasos listos')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: 'Datos de la empresa' })).toBeVisible();
  await page.getByLabel('Razón social').fill('Transportes E2E SA de CV');
  await page.getByLabel('RFC').fill('TEE010203AB1');
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Datos de la empresa guardados')).toBeVisible();
  await expect(page.getByText('1 de 8 pasos listos')).toBeVisible();
});

test('unidades: alta, edición e importación desde Excel', async () => {
  await page.goto('/unidades');
  await expect(page.getByText('Todavía no hay unidades')).toBeVisible();

  await page.getByRole('button', { name: 'Nueva unidad' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva unidad' });
  await dialog.getByLabel('Número económico').fill('U-100');
  await dialog.getByLabel('Placas').fill(`PW${stamp}`);
  await dialog.getByLabel('Modelo').fill('Sprinter 516');
  await dialog.getByLabel('Año').fill('2024');
  await dialog.getByLabel('Capacidad').fill('19');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Unidad U-100 dada de alta')).toBeVisible();

  await page.getByRole('cell', { name: /U-100/ }).click();
  const edit = page.getByRole('dialog', { name: 'Unidad U-100' });
  await edit.getByLabel('Capacidad').fill('20');
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Unidad U-100 actualizada')).toBeVisible();

  await page.getByRole('button', { name: 'Importar' }).click();
  const importing = page.getByRole('dialog', { name: 'Importar unidades' });
  await importing.getByLabel('Archivo de Excel').setInputFiles(account.vehiclesXlsx);
  await expect(importing.getByText('El archivo no tiene errores.')).toBeVisible();
  await importing.getByRole('button', { name: 'Importar 2 filas' }).click();
  await expect(page.getByText('Listo: 2 nuevos y 0 actualizados.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /E2E-01/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /E2E-02/ })).toBeVisible();
});

test('choferes: alta, QR de alta y restablecer PIN', async () => {
  await page.goto('/choferes');
  await page.getByRole('button', { name: 'Nuevo chofer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo chofer' });
  await dialog.getByLabel('Nombre completo').fill('Juan Pérez Soto');
  await dialog.getByLabel('Teléfono', { exact: true }).fill('656 123 4567');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Juan Pérez Soto dado de alta')).toBeVisible();

  await page.getByRole('cell', { name: /Juan Pérez Soto/ }).click();
  const driver = page.getByRole('dialog', { name: 'Juan Pérez Soto' });
  await driver.getByRole('button', { name: 'QR de alta' }).click();
  const qr = page.getByRole('dialog', { name: 'QR de alta de Juan Pérez Soto' });
  await expect(qr.getByRole('img', { name: /Código QR/ })).toBeVisible();
  await expect(qr.getByText(/Vence en \d+ minutos/)).toBeVisible();
  await qr.getByRole('button', { name: 'Listo' }).click();

  await driver.getByRole('button', { name: 'Restablecer PIN' }).click();
  await page
    .getByRole('dialog', { name: '¿Restablecer el PIN de Juan Pérez Soto?' })
    .getByRole('button', { name: 'Restablecer PIN' })
    .click();
  await expect(page.getByText(/PIN/).last()).toBeVisible();
});

test('clientes: planta, puerta con QR de llegada e invitación', async () => {
  await page.goto('/clientes');
  await page.getByRole('button', { name: 'Nuevo cliente' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo cliente' });
  await dialog.getByLabel('Nombre de la empresa').fill(`Maquiladora E2E ${stamp}`);
  await dialog.getByLabel('Nombre de la planta').fill('Planta Juárez 2');
  await dialog.getByLabel('Dirección').fill('Av. Tecnológico 1500');
  await dialog.getByRole('button', { name: 'Dar de alta' }).click();
  await expect(page.getByRole('heading', { name: `Maquiladora E2E ${stamp}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Planta Juárez 2' })).toBeVisible();

  await page.getByRole('button', { name: 'Puerta', exact: true }).click();
  const gate = page.getByRole('dialog', { name: 'Nueva puerta' });
  await gate.getByLabel('Nombre').fill('Caseta norte');
  await gate.getByRole('button', { name: 'Agregar puerta' }).click();
  const qr = page.getByRole('dialog', { name: 'QR de llegada · Caseta norte' });
  await expect(qr.getByRole('img', { name: /Código QR/ })).toBeVisible();
  await qr.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: 'Invitar' }).click();
  const invite = page.getByRole('dialog', { name: 'Invitar a la planta' });
  await invite.getByLabel('Nombre completo').fill('Laura Gómez');
  await invite.getByLabel('Correo').fill(`laura+${stamp}@maquiladora.example`);
  await invite.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText('Laura Gómez')).toBeVisible();
  await expect(page.getByText('Pendiente')).toBeVisible();
});

test('contratos: contrato con tarifa', async () => {
  await page.goto('/contratos');
  await page.getByRole('button', { name: 'Nuevo contrato' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo contrato' });
  await dialog.getByRole('combobox', { name: 'Cliente' }).click();
  await page.getByRole('option', { name: `Maquiladora E2E ${stamp}` }).click();
  await dialog.getByLabel('Nombre').fill('Transporte de personal 2026');
  await dialog.getByRole('button', { name: 'Crear contrato' }).click();
  await expect(page.getByRole('heading', { name: 'Transporte de personal 2026' })).toBeVisible();

  await page.getByRole('button', { name: 'Tarifa', exact: true }).click();
  const rate = page.getByRole('dialog', { name: 'Nueva tarifa' });
  await rate.getByLabel('Monto (MXN)').fill('1500');
  await rate.getByRole('button', { name: 'Agregar tarifa' }).click();
  await expect(page.getByText('$1,500.00')).toBeVisible();
});

test('el asistente refleja lo que ya se cargó', async () => {
  await page.goto('/configuracion-inicial');
  // Empresa, flota (unidades + chofer), clientes e invitación a la planta.
  await expect(page.getByText('4 de 8 pasos listos')).toBeVisible();
  const steps = page.getByRole('navigation', { name: 'Pasos' });
  for (const name of [
    'Datos de la empresa',
    'Unidades y choferes',
    'Clientes y plantas',
    'Invitar a la planta',
  ]) {
    await expect(steps.getByRole('button', { name }).getByLabel('Listo')).toBeVisible();
  }
});
