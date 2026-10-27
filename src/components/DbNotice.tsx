import styles from "./DbNotice.module.css";

/** Shown instead of a page when the database can't be reached. */
export function DbNotice({ error }: { error: unknown }) {
  const missing = error instanceof Error && error.message.includes("DATABASE_URL");
  return (
    <div className={styles.box} role="alert">
      <h1>{missing ? "The database isn't connected yet" : "Couldn't reach the database"}</h1>
      <p>
        {missing
          ? "Add your Neon connection string as DATABASE_URL in Vercel's Environment Variables (Settings), then redeploy."
          : "The database may be waking up. Wait a few seconds and refresh the page."}
      </p>
    </div>
  );
}
