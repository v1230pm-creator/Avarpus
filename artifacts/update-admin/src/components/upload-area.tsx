import React, { useState } from 'react';
import { useAppUpdateUploadUrl } from '@workspace/api-client-react';
import { Upload, AlertCircle } from 'lucide-react';
import { cn, formatBytes, apiErrorMessage } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';

interface FileUploadProgress {
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

interface UploadAreaProps {
  onUploadSuccess: (objectPath: string, file: File) => void;
  accept: string;
  maxSizeMB?: number;
  title: string;
  description: string;
  apkMode?: boolean;
}

export function UploadArea({ onUploadSuccess, accept, maxSizeMB = 50, title, description, apkMode = false }: UploadAreaProps) {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<FileUploadProgress | null>(null);
  
  const getUploadUrl = useAppUpdateUploadUrl();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateFile = async (selectedFile: File): Promise<string | null> => {
    if (maxSizeMB && selectedFile.size > maxSizeMB * 1024 * 1024) {
      return `File must be less than ${maxSizeMB}MB`;
    }
    
    if (apkMode) {
      if (!selectedFile.name.toLowerCase().endsWith('.apk')) {
        return 'File must be an .apk file';
      }
      if (selectedFile.size < 1024 * 1024) {
        return 'File is too small to be a valid APK';
      }
      
      // Read first 2 bytes to check for "PK" magic number
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const buffer = e.target?.result as ArrayBuffer;
          const bytes = new Uint8Array(buffer);
          if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // 'P' 'K'
            resolve(null);
          } else {
            resolve('Invalid APK format. Magic number mismatch.');
          }
        };
        reader.onerror = () => resolve('Failed to read file');
        reader.readAsArrayBuffer(selectedFile.slice(0, 2));
      });
    }
    
    return null;
  };

  const processFile = async (selectedFile: File) => {
    const error = await validateFile(selectedFile);
    if (error) {
      setUploadState({ progress: 0, uploadedBytes: 0, totalBytes: selectedFile.size, status: 'error', error });
      return;
    }
    
    setFile(selectedFile);
    setUploadState({ progress: 0, uploadedBytes: 0, totalBytes: selectedFile.size, status: 'uploading' });
    
    try {
      // 1. Get upload URL
      const { uploadURL, objectPath } = await getUploadUrl.mutateAsync();
      
      // 2. Upload via XMLHttpRequest to get progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            setUploadState({
              progress: percentComplete,
              uploadedBytes: event.loaded,
              totalBytes: event.total,
              status: 'uploading'
            });
          }
        };
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };
        
        xhr.onerror = () => reject(new Error('Network error during upload'));
        
        xhr.open('PUT', uploadURL, true);
        xhr.setRequestHeader('Content-Type', apkMode ? 'application/vnd.android.package-archive' : selectedFile.type || 'application/octet-stream');
        xhr.send(selectedFile);
      });
      
      setUploadState(prev => prev ? { ...prev, progress: 100, status: 'success' } : null);
      onUploadSuccess(objectPath, selectedFile);
      
    } catch (err: any) {
      console.error('Upload failed:', err);
      setUploadState(prev => prev ? {
        ...prev,
        status: 'error',
        error: apiErrorMessage(err, 'Upload failed. Please try again.'),
      } : null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  if (uploadState?.status === 'uploading') {
    return (
      <div className="border border-border rounded-lg p-6 flex flex-col items-center justify-center bg-card">
        <div className="flex items-center gap-3 mb-4">
          <Spinner size={24} label={null} />
          <div className="text-sm font-medium">Uploading {file?.name}...</div>
        </div>
        <Progress value={uploadState.progress} className="w-full max-w-sm h-2 mb-2" />
        <div className="text-xs text-muted-foreground w-full max-w-sm flex justify-between">
          <span>{formatBytes(uploadState.uploadedBytes)} of {formatBytes(uploadState.totalBytes)}</span>
          <span>{uploadState.progress}%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <label
        htmlFor={`file-upload-${title.replace(/\s+/g, '-').toLowerCase()}`}
        className={cn(
          "relative flex flex-col items-center justify-center w-full min-h-[160px] p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors duration-200",
          dragActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50 bg-card",
          uploadState?.status === 'error' ? "border-destructive/50" : ""
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center text-center space-y-2">
          <div className="p-3 bg-primary/10 rounded-full text-primary mb-2">
            <Upload className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground max-w-[250px]">{description}</p>
        </div>
        <input 
          id={`file-upload-${title.replace(/\s+/g, '-').toLowerCase()}`}
          type="file" 
          className="hidden" 
          accept={accept} 
          onChange={handleChange} 
        />
      </label>
      
      {uploadState?.status === 'error' && (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {uploadState.error}
            <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={() => setUploadState(null)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
