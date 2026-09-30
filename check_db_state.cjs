const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const users = await prisma.$queryRaw`SELECT role FROM public.users`;
    console.log('Total users:', users.length);
    const roles = {};
    users.forEach(u => {
      roles[u.role] = (roles[u.role] || 0) + 1;
    });
    console.log('Roles breakdown:', roles);
  } catch (e) {
    console.error(e.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
