import { Spinner } from "@/components/ui/spinner";
import { AppRoutes } from "@/app/routes";
import { useBootstrapSession } from "@/features/auth/useBootstrapSession";

export function App() {
  const ready = useBootstrapSession();
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  return <AppRoutes />;
}
