export function PolicySection() {
  return (
    <div>
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-nv-green/40 bg-nv-green/10 text-xs text-nv-green font-mono mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-nv-green" />
        NemoClaw bonus criterion
      </div>
      <h2 className="text-3xl md:text-4xl font-bold mb-6">
        The guardrails are real, not narrative.
      </h2>
      <p className="text-nv-muted max-w-2xl text-lg leading-relaxed mb-12">
        Six custom NemoClaw policy presets enforce the agent&apos;s tool surface
        and network egress. Out of the box, the sandbox denies all outbound
        HTTPS — each preset opens a narrow, auditable slice.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <PolicyCard
          name="brand-fetch"
          hosts={[
            "stripe.com",
            "linear.app",
            "vercel.com",
            "anthropic.com",
            "+9 more",
          ]}
          purpose="HTTPS GET to known brand domains for fetch_brand.py"
        />
        <PolicyCard
          name="nemotron-direct"
          hosts={["integrate.api.nvidia.com"]}
          purpose="Nemotron 3 Super 120B inference endpoint"
        />
        <PolicyCard
          name="remotion-cdn"
          hosts={["remotion.media"]}
          purpose="Chrome headless shell download for Remotion render"
        />
        <PolicyCard
          name="debian-mirror"
          hosts={["deb.debian.org"]}
          purpose="libnspr4 / libnss3 .deb packages for Chrome headless"
        />
        <PolicyCard
          name="github-cdn"
          hosts={[
            "raw.githubusercontent.com",
            "objects.githubusercontent.com",
            "api.github.com",
          ]}
          purpose="Repository asset fetch when needed"
        />
        <PolicyCard
          name="higgsfield"
          hosts={[
            "api.higgsfield.ai",
            "fnf.higgsfield.ai",
            "d8j0ntlcm91z4.cloudfront.net",
          ]}
          purpose="Reserved for v2 asset-mode (deferred)"
          deferred
        />
      </div>

      <div className="mt-12 p-6 rounded-lg border border-nv-green/30 bg-nv-green/5">
        <div className="text-xs uppercase tracking-wider text-nv-green font-mono mb-3">
          Real enforcement, not theoretical
        </div>
        <p className="text-nv-text leading-relaxed">
          During build, the script tried to curl Higgsfield&apos;s CDN at{" "}
          <code className="text-nv-green font-mono text-sm bg-black/40 px-1.5 py-0.5 rounded">
            d8j0ntlcm91z4.cloudfront.net
          </code>{" "}
          and the sandbox proxy returned{" "}
          <span className="text-nv-green font-semibold">403 Forbidden</span>{" "}
          until the host was added to the policy. The guardrails are
          runtime-enforced — not a Python wrapper anyone could bypass.
        </p>
      </div>
    </div>
  );
}

function PolicyCard({
  name,
  hosts,
  purpose,
  deferred,
}: {
  name: string;
  hosts: string[];
  purpose: string;
  deferred?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${deferred ? "border-nv-border bg-nv-surface/50 opacity-60" : "border-nv-border bg-nv-surface"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-sm text-nv-green">{name}.yaml</div>
        {deferred && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-nv-muted">
            deferred
          </span>
        )}
      </div>
      <p className="text-sm text-nv-muted leading-relaxed mb-3">{purpose}</p>
      <div className="flex flex-wrap gap-1.5">
        {hosts.map((h) => (
          <span
            key={h}
            className="text-[11px] font-mono px-2 py-0.5 rounded border border-nv-border bg-black/40 text-nv-muted"
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}
