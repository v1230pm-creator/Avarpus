import { useState, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useLatestAppUpdate, 
  useCreateAppUpdate, 
  useUpdateAppUpdate, 
  usePublishAppUpdate,
  useUnpublishAppUpdate,
  useListAppUpdates,
  getListAppUpdatesQueryKey,
  getLatestAppUpdateQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SectionLoader, Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { UploadArea } from "@/components/upload-area";
import { AuthedImage } from "@/components/authed-image";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { 
  Save, 
  Send, 
  Undo,
  ArrowLeft, 
  Smartphone, 
  Plus, 
  Trash2,
  GripVertical,
  FileCheck,
  AlertTriangle,
  X
} from "lucide-react";
import { apiErrorMessage, formatBytes } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const updateTypes = ["optional", "recommended", "critical"] as const;
const categories = ["NEW FEATURES", "IMPROVEMENTS", "BUG FIXES", "SECURITY"] as const;

const releaseNotesSchema = z.array(
  z.object({
    category: z.enum(categories),
    items: z.array(z.object({ text: z.string() }))
  })
);

const releaseFormSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver (e.g. 1.0.0)"),
  buildNumber: z.coerce.number().min(1),
  releaseDate: z.string().optional(),
  updateType: z.enum(updateTypes),
  minAndroidVersion: z.string().optional().nullable(),
  demoVideoUrl: z.string().url("Must be a valid URL").optional().or(z.literal('')),
  apkPath: z.string().nullable().optional(),
  screenshots: z.array(z.string()).default([]),
  releaseNotes: releaseNotesSchema.default([]),
});

type ReleaseFormValues = z.infer<typeof releaseFormSchema>;

export default function ReleaseEditor() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const isNew = !params.id || params.id === "new";
  const id = isNew ? "" : params.id!;
  
  // Use latest to populate defaults for new
  const { data: latestInfo } = useLatestAppUpdate(undefined, { 
    query: { enabled: isNew, queryKey: getLatestAppUpdateQueryKey() } 
  });
  
  // Actually we need to fetch the specific update if we are editing
  // The API generated hooks don't seem to expose `useGetAppUpdate`, they only have `useListAppUpdates`.
  // Wait, I need to fetch the specific update.
  const { data: listData, isLoading: listLoading } = useListAppUpdates({
    query: { enabled: !isNew, queryKey: getListAppUpdatesQueryKey() }
  });
  
  const existingUpdate = !isNew ? listData?.updates?.find(u => u.id === id) : null;
  
  const createUpdate = useCreateAppUpdate();
  const updateUpdate = useUpdateAppUpdate();
  const publishUpdate = usePublishAppUpdate();
  const unpublishUpdate = useUnpublishAppUpdate();
  
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [rollbackWarning, setRollbackWarning] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "notes" | "media">("details");
  
  const form = useForm<ReleaseFormValues>({
    resolver: zodResolver(releaseFormSchema),
    defaultValues: {
      version: "",
      buildNumber: 1,
      updateType: "optional",
      minAndroidVersion: "",
      demoVideoUrl: "",
      apkPath: null,
      screenshots: [],
      releaseNotes: [{ category: "NEW FEATURES", items: [{ text: "" }] }]
    }
  });

  const { fields: noteSections, append: appendSection, remove: removeSection } = useFieldArray({
    control: form.control,
    name: "releaseNotes"
  });

  // Init form
  const initialized = useRef(false);
  if (!initialized.current) {
    if (isNew && latestInfo) {
      const latestUpdate = latestInfo.update && typeof latestInfo.update === "object" ? latestInfo.update : null;
      const parts = (latestUpdate?.version || "1.0.0").split('.');
      const nextVersion = `${parts[0]}.${parts[1]}.${parseInt(parts[2] || "0") + 1}`;
      form.reset({
        version: nextVersion,
        buildNumber: (latestUpdate?.buildNumber || 0) + 1,
        updateType: "optional",
        minAndroidVersion: latestUpdate?.minAndroidVersion || "",
        demoVideoUrl: "",
        apkPath: null,
        screenshots: [],
        releaseNotes: [{ category: "NEW FEATURES", items: [{ text: "" }] }]
      });
      initialized.current = true;
    } else if (!isNew && existingUpdate) {
      // transform releaseNotes
      let parsedNotes = [{ category: "NEW FEATURES" as const, items: [{ text: "" }] }];
      if (Array.isArray(existingUpdate.releaseNotes)) {
        parsedNotes = existingUpdate.releaseNotes.map((section: any) => ({
          category: section.category || "NEW FEATURES",
          items: Array.isArray(section.items) ? section.items.map((i: string) => ({ text: i })) : [{ text: "" }]
        }));
      }
      
      form.reset({
        version: existingUpdate.version,
        buildNumber: existingUpdate.buildNumber,
        updateType: existingUpdate.updateType as any,
        minAndroidVersion: existingUpdate.minAndroidVersion || "",
        demoVideoUrl: existingUpdate.demoVideoUrl || "",
        apkPath: (existingUpdate as any).apkPath || null,
        screenshots: Array.isArray(existingUpdate.screenshots) ? existingUpdate.screenshots : [],
        releaseNotes: parsedNotes
      });
      initialized.current = true;
    }
  }

  const isPublished = existingUpdate?.status === "published";

  const onInvalid = (errors: any) => {
    const firstKey = Object.keys(errors)[0];
    const detailTabs: Record<string, "details" | "notes" | "media"> = {
      version: "details", buildNumber: "details", updateType: "details",
      minAndroidVersion: "details", demoVideoUrl: "details",
      releaseNotes: "notes", apkPath: "media", screenshots: "media",
    };
    if (firstKey && detailTabs[firstKey]) setActiveTab(detailTabs[firstKey]);
    const msg = errors[firstKey]?.message || "Please check the highlighted fields";
    toast({ title: "Cannot save draft", description: `${firstKey}: ${msg}`, variant: "destructive" });
  };

  const onSubmit = (data: ReleaseFormValues) => {
    // Transform notes back to API format
    const formattedNotes = data.releaseNotes.map(section => ({
      category: section.category,
      items: section.items.map(i => i.text).filter(t => t.trim() !== "")
    })).filter(s => s.items.length > 0);

    const payload = {
      ...data,
      demoVideoUrl: data.demoVideoUrl || null,
      minAndroidVersion: data.minAndroidVersion || null,
      releaseNotes: formattedNotes
    };
    if (!isNew && data.apkPath === (existingUpdate as any)?.apkPath) {
      delete payload.apkPath;
    }

    if (isNew) {
      createUpdate.mutate({ data: payload }, {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getListAppUpdatesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getLatestAppUpdateQueryKey() });
          toast({ title: "Draft created successfully" });
          setLocation(`/releases/${res.update.id}`);
        },
        onError: (err) => {
          toast({
            title: "Failed to create draft",
            description: apiErrorMessage(err, "Please check the release details and try again."),
            variant: "destructive",
          });
        }
      });
    } else {
      updateUpdate.mutate({ id, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAppUpdatesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getLatestAppUpdateQueryKey() });
          toast({ title: "Release updated successfully" });
        },
        onError: (err) => {
          toast({
            title: "Failed to update release",
            description: apiErrorMessage(err, "Please check the release details and try again."),
            variant: "destructive",
          });
        }
      });
    }
  };

  const handlePublish = (allowLowerBuild = false) => {
    publishUpdate.mutate({ id, data: { allowLowerBuild } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppUpdatesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getLatestAppUpdateQueryKey() });
        setPublishDialogOpen(false);
        setRollbackWarning(false);
        toast({ title: "Release published successfully" });
      },
      onError: (err: any) => {
        if (
          err?.status === 409 &&
          !allowLowerBuild &&
          /confirm the rollback/i.test(apiErrorMessage(err, ""))
        ) {
          setRollbackWarning(true);
        } else {
          toast({
            title: "Publish failed",
            description: apiErrorMessage(err, "Please reload the release and try again."),
            variant: "destructive",
          });
        }
      }
    });
  };

  const handleUnpublish = () => {
    unpublishUpdate.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppUpdatesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getLatestAppUpdateQueryKey() });
        toast({ title: "Release unpublished" });
      },
      onError: (err) => {
        toast({
          title: "Failed to unpublish",
          description: apiErrorMessage(err, "Please reload the release and try again."),
          variant: "destructive",
        });
      }
    });
  };

  if (!isNew && listLoading) {
    return <SectionLoader className="flex-1" />;
  }

  const screenshots = form.watch("screenshots");
  const apkPath = form.watch("apkPath");

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 md:p-6 border-b bg-card shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/releases")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-3">
              {isNew ? "New Release" : `Release v${existingUpdate?.version}`}
              {!isNew && (
                <Badge variant={isPublished ? "success" : existingUpdate?.status === "archived" ? "outline" : "secondary"}>
                  {existingUpdate?.status?.toUpperCase()}
                </Badge>
              )}
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!isNew && isPublished && (
            <Button variant="outline" onClick={handleUnpublish} disabled={unpublishUpdate.isPending}>
              {unpublishUpdate.isPending ? <Spinner size={16} label={null} /> : <Undo className="mr-2 h-4 w-4" />}
              Unpublish
            </Button>
          )}
          
          {!isNew && !isPublished && (
            <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setPublishDialogOpen(true)}>
              <Send className="mr-2 h-4 w-4" />
              {existingUpdate?.status === "archived" ? "Republish (Rollback)" : "Publish"}
            </Button>
          )}
          
          {!isPublished && existingUpdate?.status !== "archived" && (
            <Button onClick={form.handleSubmit(onSubmit, onInvalid)} disabled={createUpdate.isPending || updateUpdate.isPending}>
              {(createUpdate.isPending || updateUpdate.isPending) ? <Spinner className="mr-2" size={16} label={null} /> : <Save className="mr-2 h-4 w-4" />}
              Save Draft
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-muted/20">
        <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
          
          <div className="flex border-b">
            <button 
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'details' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab('details')}
            >
              Release Details
            </button>
            <button 
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'notes' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab('notes')}
            >
              Release Notes
            </button>
            <button 
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'media' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab('media')}
            >
              Media & Artifacts
            </button>
          </div>

          <Form {...form}>
            <form className="space-y-6">
              
              {/* DETAILS TAB */}
              <div className={activeTab === 'details' ? 'block' : 'hidden'}>
                <Card>
                  <CardHeader>
                    <CardTitle>Version Info</CardTitle>
                    <CardDescription>Core identifiers for this release.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <div>
                        <div className="font-semibold">Use the actual APK build identity</div>
                        <p className="mt-1 text-muted-foreground">
                          Version and Build Number must exactly match the expo.dev build details. Upload a fresh APK
                          for every new release; reusing an old APK or only changing these labels is blocked.
                        </p>
                      </div>
                    </div>
                    <FormField control={form.control} name="version" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Version String (SemVer)</FormLabel>
                        <FormControl><Input placeholder="1.2.0" {...field} disabled={isPublished} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="buildNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Build Number</FormLabel>
                        <FormControl><Input type="number" {...field} disabled={isPublished} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="updateType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Update Urgency</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isPublished}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="optional">Optional</SelectItem>
                            <SelectItem value="recommended">Recommended</SelectItem>
                            <SelectItem value="critical">Critical (Forced)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="minAndroidVersion" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Min Android API Level</FormLabel>
                        <FormControl><Input placeholder="e.g. 24" {...field} value={field.value || ''} disabled={isPublished} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </CardContent>
                </Card>
              </div>

              {/* NOTES TAB */}
              <div className={activeTab === 'notes' ? 'block' : 'hidden'}>
                <div className="space-y-6">
                  {noteSections.map((section, sIdx) => (
                    <Card key={section.id}>
                      <CardHeader className="flex flex-row items-center justify-between py-4">
                        <FormField control={form.control} name={`releaseNotes.${sIdx}.category`} render={({ field }) => (
                          <FormItem className="flex-1 max-w-[250px] mb-0">
                            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isPublished}>
                              <FormControl><SelectTrigger className="border-none font-bold text-lg bg-muted/50 h-auto py-2"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                        {!isPublished && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeSection(sIdx)} className="text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </CardHeader>
                      <CardContent>
                        <NotesList sIdx={sIdx} form={form} isPublished={isPublished} />
                      </CardContent>
                    </Card>
                  ))}
                  
                  {!isPublished && (
                    <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => appendSection({ category: "IMPROVEMENTS", items: [{ text: "" }] })}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Section
                    </Button>
                  )}
                </div>
              </div>

              {/* MEDIA TAB */}
              <div className={activeTab === 'media' ? 'block' : 'hidden'}>
                <div className="space-y-6">
                  
                  <Card>
                    <CardHeader>
                      <CardTitle>APK Bundle</CardTitle>
                      <CardDescription>
                        Upload the newly compiled, signed Android package from the latest GitHub branch.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {apkPath ? (
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 text-primary rounded-md">
                              <FileCheck className="h-6 w-6" />
                            </div>
                            <div>
                              <div className="font-medium text-sm">Package Uploaded</div>
                              <div className="text-xs text-muted-foreground font-mono mt-1">{apkPath.split('/').pop()}</div>
                            </div>
                          </div>
                          {!isPublished && (
                            <Button type="button" variant="outline" size="sm" onClick={() => form.setValue("apkPath", null)}>
                              Replace
                            </Button>
                          )}
                        </div>
                      ) : (
                        <UploadArea 
                          title="Upload APK" 
                          description="Drag and drop or click to upload the signed .apk file (up to 500MB)." 
                          accept=".apk"
                          maxSizeMB={500}
                          apkMode={true}
                          onUploadSuccess={(path) => form.setValue("apkPath", path)}
                        />
                      )}
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle>Screenshots</CardTitle>
                      <CardDescription>Visual previews shown to users before they update.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        {screenshots.map((path, idx) => (
                          <div key={idx} className="relative group aspect-[9/16] rounded-md overflow-hidden border bg-muted">
                            <AuthedImage objectPath={path} className="w-full h-full object-cover" />
                            {!isPublished && (
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Button type="button" variant="destructive" size="icon" onClick={() => {
                                  const newScreenshots = [...screenshots];
                                  newScreenshots.splice(idx, 1);
                                  form.setValue("screenshots", newScreenshots);
                                }}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      {!isPublished && (
                        <UploadArea 
                          title="Add Screenshot" 
                          description="JPG, PNG up to 10MB" 
                          accept="image/*"
                          onUploadSuccess={(path) => form.setValue("screenshots", [...screenshots, path])}
                        />
                      )}
                    </CardContent>
                  </Card>

                </div>
              </div>
              
            </form>
          </Form>
        </div>
      </div>
      
      {/* Publish Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rollbackWarning ? "Warning: Rollback Detected" : "Publish Release"}</DialogTitle>
            <DialogDescription>
              {rollbackWarning 
                ? "You are trying to publish a build number that is lower than the currently live release. This is technically a rollback." 
                : "This will make the update available to all staff devices immediately. The previously published release will be automatically archived."}
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>Cancel</Button>
            <Button 
              variant={rollbackWarning ? "destructive" : "default"}
              onClick={() => handlePublish(rollbackWarning)}
              disabled={publishUpdate.isPending}
            >
              {publishUpdate.isPending && <Spinner className="mr-2" size={16} label={null} />}
              {rollbackWarning ? "Force Rollback" : "Confirm Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Sub-component for list items to avoid massive file
function NotesList({ sIdx, form, isPublished }: any) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: `releaseNotes.${sIdx}.items`
  });
  
  return (
    <div className="space-y-3">
      {fields.map((item, iIdx) => (
        <div key={item.id} className="flex items-start gap-2">
          {!isPublished && (
            <div className="mt-2.5 text-muted-foreground"><GripVertical className="h-4 w-4 opacity-50" /></div>
          )}
          <div className="flex-1">
            <FormField control={form.control} name={`releaseNotes.${sIdx}.items.${iIdx}.text`} render={({ field }) => (
              <FormItem className="mb-0 space-y-0">
                <FormControl><Textarea className="min-h-[40px] py-2 resize-none" placeholder="Describe this change..." {...field} disabled={isPublished} /></FormControl>
              </FormItem>
            )} />
          </div>
          {!isPublished && (
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(iIdx)} className="mt-0.5 text-muted-foreground hover:text-destructive">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {!isPublished && (
        <Button type="button" variant="ghost" size="sm" onClick={() => append({ text: "" })} className="ml-6 mt-2 text-primary hover:text-primary">
          <Plus className="mr-1 h-3 w-3" /> Add item
        </Button>
      )}
    </div>
  );
}

