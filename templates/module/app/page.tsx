import { Trans } from "@lingui/react/macro";
import { useQuery } from "../../../src/store";
import { Spinner, TopBar, useDocumentTitle } from "../../../src/ui";
import manifest from "../module";

export function Page() {
  const name = manifest.label();
  useDocumentTitle(name);
  const { data } = useQuery<{ hello: string }>("/__FOLDER__/hello");
  return (
    <main class="page">
      <TopBar title={name} back="/" />
      <div class="content">
        {data ? (
          <p>
            <Trans>This is the page of the module {name}.</Trans>
          </p>
        ) : (
          <Spinner />
        )}
      </div>
    </main>
  );
}
