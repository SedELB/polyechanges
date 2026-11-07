import type { Db } from './open.js';
import type { University } from '../../shared/types.js';

export function upsertUniversity(db: Db, u: University): void {
  db.prepare(
    `INSERT INTO universities (id, name, move_on_name, country_code, city, lat, lng, website,
       catalog_url, credit_system, contact_hours_per_credit, terms_json, restrictions,
       exchange_contact, catalog_public)
     VALUES (@id, @name, @moveOnName, @countryCode, @city, @lat, @lng, @website,
       @catalogUrl, @creditSystem, @contactHoursPerCredit, @terms, @restrictions,
       @exchangeContact, @catalogPublic)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, move_on_name = excluded.move_on_name,
       country_code = excluded.country_code, city = excluded.city, lat = excluded.lat,
       lng = excluded.lng, website = excluded.website, catalog_url = excluded.catalog_url,
       credit_system = excluded.credit_system,
       contact_hours_per_credit = excluded.contact_hours_per_credit,
       terms_json = excluded.terms_json, restrictions = excluded.restrictions,
       exchange_contact = excluded.exchange_contact, catalog_public = excluded.catalog_public`,
  ).run({
    id: u.id,
    name: u.name,
    moveOnName: u.moveOnName,
    countryCode: u.countryCode,
    city: u.city,
    lat: u.lat,
    lng: u.lng,
    website: u.website,
    catalogUrl: u.catalogUrl,
    creditSystem: u.creditSystem,
    contactHoursPerCredit: u.contactHoursPerCredit,
    terms: JSON.stringify(u.terms),
    restrictions: u.restrictions,
    exchangeContact: u.exchangeContact,
    catalogPublic: u.catalogPublic ? 1 : 0,
  });
}

interface UniversityRow {
  id: string;
  name: string;
  move_on_name: string;
  country_code: University['countryCode'];
  city: string;
  lat: number;
  lng: number;
  website: string;
  catalog_url: string | null;
  credit_system: University['creditSystem'];
  contact_hours_per_credit: number | null;
  terms_json: string;
  restrictions: string | null;
  exchange_contact: string | null;
  catalog_public: number;
}

export function getUniversity(db: Db, id: string): University | null {
  const r = db.prepare('SELECT * FROM universities WHERE id = ?').get(id) as
    | UniversityRow
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    moveOnName: r.move_on_name,
    countryCode: r.country_code,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    website: r.website,
    catalogUrl: r.catalog_url,
    creditSystem: r.credit_system,
    contactHoursPerCredit: r.contact_hours_per_credit,
    terms: JSON.parse(r.terms_json),
    restrictions: r.restrictions,
    exchangeContact: r.exchange_contact,
    catalogPublic: r.catalog_public === 1,
  };
}
