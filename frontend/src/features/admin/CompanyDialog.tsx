import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TIMEZONES } from "@/features/settings/companyApi";
import { errorMessage } from "@/lib/apiError";
import type { AdminCompany } from "@/types/api";
import { adminKeys, createCompany, updateCompany, type CreatedCompany } from "./adminApi";

export function CompanyDialog({
  company,
  onClose,
  onCreated,
}: {
  company?: AdminCompany;
  onClose: () => void;
  onCreated?: (created: CreatedCompany) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(company?.name ?? "");
  const [timezone, setTimezone] = useState(company?.timezone ?? "America/Sao_Paulo");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");

  const valid = name.trim() && (company || (adminName.trim() && adminEmail.trim()));
  const zones = TIMEZONES.some((z) => z.value === timezone) ? TIMEZONES : [{ value: timezone, label: timezone }, ...TIMEZONES];

  const mutation = useMutation({
    mutationFn: (): Promise<AdminCompany | CreatedCompany> => {
      const base = { name: name.trim(), timezone };
      if (company) return updateCompany(company.id, base);
      return createCompany({
        ...base,
        admin: { name: adminName.trim(), email: adminEmail.trim(), phone: adminPhone.trim() || null },
      });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.companies });
      toast.success(company ? "Empresa atualizada" : "Empresa criada");
      onClose();
      if (!company) onCreated?.(saved as CreatedCompany);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={company ? "Editar empresa" : "Nova empresa"}>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="company-name">Nome da empresa</Label>
            <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="company-timezone">Fuso horário</Label>
            <Select id="company-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </Select>
          </div>
          {!company && (
            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">Primeiro administrador</legend>
              <div>
                <Label htmlFor="admin-name">Nome</Label>
                <Input id="admin-name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="admin-email">E-mail</Label>
                <Input id="admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="admin-phone">WhatsApp</Label>
                <Input
                  id="admin-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(11) 98888-7777"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                />
              </div>
              <p className="text-xs text-ink-muted">
                O administrador recebe uma senha temporária e precisa trocá-la no primeiro acesso.
              </p>
            </fieldset>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!valid}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
