/** SQL-Dateien als Text (Vite ?raw), z. B. scripts/staging-sanitize.sql */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
