import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set in environment.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to Neon DB successfully.');

    // 1. Prepare Auth Schema mock & authenticated role
    console.log('Setting up auth mock schema & roles...');
    
    // Create role authenticated if it doesn't exist
    try {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated;
          END IF;
        END
        $$;
      `);
    } catch (err) {
      console.warn('Could not create role authenticated (might already exist or permission issue):', err.message);
    }

    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE,
        password_hash text,
        created_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
          (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
        );
      $$;
    `);

    // 2. Read and apply migrations
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files.`);

    for (const file of files) {
      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      // Execute the entire file contents
      await client.query(sql);
    }

    console.log('All migrations applied successfully.');

    // 3. Seed default admin user
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    
    if (!adminEmail || !adminPassword) {
      console.warn('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are not set in environment. Skipping admin seed.');
      console.log('Database seeded and migration completed successfully.');
      return;
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(adminPassword, salt);

    // Check if admin user already exists
    const checkRes = await client.query('SELECT id FROM auth.users WHERE email = $1', [adminEmail]);
    let adminId;
    if (checkRes.rows.length === 0) {
      console.log('Seeding default admin user...');
      const insertUserRes = await client.query(
        'INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [adminEmail, passwordHash]
      );
      adminId = insertUserRes.rows[0].id;
    } else {
      adminId = checkRes.rows[0].id;
      console.log('Admin user already exists in auth.users.');
    }

    // Upsert admin staff profile
    await client.query(`
      INSERT INTO public.staff_profiles (id, name, role, active)
      VALUES ($1, 'System Administrator', 'admin', true)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active;
    `, [adminId]);

    console.log('Database seeded and migration completed successfully.');

  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
