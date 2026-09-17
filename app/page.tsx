import { GalaxyMap } from "../components/galaxy-map";
import { compactJobs, getJobSnapshot } from "../lib/jobs";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getJobSnapshot();
  const jobs = compactJobs(snapshot.jobs);
  const sources = (snapshot.sourceStatus ?? []).slice(0, 5);
  const companies = new Set(jobs.map((job) => job.company)).size;
  return <GalaxyMap jobCount={jobs.length} companyCount={companies} sourceCount={sources.length} />;
}
