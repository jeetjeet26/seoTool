export default function Loading() {
  return <div className="loading-page" aria-label="Loading"><div className="skeleton wide"/><div className="skeleton-grid">{[1,2,3,4].map((item) => <div className="skeleton cardish" key={item}/>)}</div><div className="skeleton tableish"/></div>;
}
