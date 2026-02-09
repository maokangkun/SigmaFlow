import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Loader2, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ModelPricing {
  model_name: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
  provider: string;
  category: string;
}

interface ModelPricingResponse {
  models: ModelPricing[];
  default_pricing: ModelPricing;
}

export function ModelPricesPage() {
  const [pricing, setPricing] = useState<ModelPricingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState<Partial<ModelPricing>>({});

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/admin/api/model-prices', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load pricing');

      const data: ModelPricingResponse = await response.json();
      setPricing(data);
    } catch (error) {
      console.error('Failed to load pricing:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (modelName: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      const model = pricing?.models.find((m) => m.model_name === modelName);
      if (!model) return;

      const response = await fetch(`/admin/api/model-prices/${encodeURIComponent(modelName)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_name: model.model_name,
          input_price_per_1k: model.input_price_per_1k,
          output_price_per_1k: model.output_price_per_1k,
          provider: model.provider,
          category: model.category,
        }),
      });

      if (!response.ok) throw new Error('Failed to update pricing');

      setEditingModel(null);
      loadPricing();
    } catch (error) {
      console.error('Failed to update pricing:', error);
      alert('Failed to update pricing');
    }
  };

  const handleDelete = async (modelName: string) => {
    if (!confirm(`Delete pricing for ${modelName}?`)) return;

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/admin/api/model-prices/${encodeURIComponent(modelName)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete pricing');

      loadPricing();
    } catch (error) {
      console.error('Failed to delete pricing:', error);
      alert('Failed to delete pricing');
    }
  };

  const handleAddModel = async () => {
    if (!formData.model_name || formData.input_price_per_1k === undefined || formData.output_price_per_1k === undefined) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/admin/api/model-prices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_name: formData.model_name,
          input_price_per_1k: formData.input_price_per_1k,
          output_price_per_1k: formData.output_price_per_1k,
          provider: formData.provider || 'Unknown',
          category: formData.category || 'other',
        }),
      });

      if (!response.ok) throw new Error('Failed to create pricing');

      setShowAddDialog(false);
      setFormData({});
      loadPricing();
    } catch (error) {
      console.error('Failed to create pricing:', error);
      alert('Failed to create pricing');
    }
  };

  const updateModelField = (modelName: string, field: keyof ModelPricing, value: any) => {
    if (!pricing) return;
    
    setPricing({
      ...pricing,
      models: pricing.models.map((m) =>
        m.model_name === modelName ? { ...m, [field]: value } : m
      ),
    });
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(6)}`;
  };

  if (loading) {
    return (
      <div className="flex-1 bg-background p-8">
        <div className="max-w-[1800px] mx-auto flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background p-8">
      <div className="max-w-[1800px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Model Pricing</h1>
            <p className="text-muted-foreground mt-2">
              Configure API pricing for different AI models
            </p>
          </div>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Model
          </Button>
        </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured Models</CardTitle>
          <CardDescription>
            Pricing is per 1,000 tokens. Input and output tokens are priced separately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Input (per 1K)</TableHead>
                <TableHead className="text-right">Output (per 1K)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing?.models.map((model) => (
                <TableRow key={model.model_name}>
                  <TableCell className="font-medium">
                    {editingModel === model.model_name ? (
                      <Input
                        value={model.model_name}
                        disabled
                        className="w-full"
                      />
                    ) : (
                      model.model_name
                    )}
                  </TableCell>
                  <TableCell>
                    {editingModel === model.model_name ? (
                      <Input
                        value={model.provider}
                        onChange={(e) =>
                          updateModelField(model.model_name, 'provider', e.target.value)
                        }
                        className="w-full"
                      />
                    ) : (
                      model.provider
                    )}
                  </TableCell>
                  <TableCell>
                    {editingModel === model.model_name ? (
                      <Input
                        value={model.category}
                        onChange={(e) =>
                          updateModelField(model.model_name, 'category', e.target.value)
                        }
                        className="w-full"
                      />
                    ) : (
                      model.category
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editingModel === model.model_name ? (
                      <Input
                        type="number"
                        step="0.000001"
                        value={model.input_price_per_1k}
                        onChange={(e) =>
                          updateModelField(
                            model.model_name,
                            'input_price_per_1k',
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-32 ml-auto"
                      />
                    ) : (
                      formatPrice(model.input_price_per_1k)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editingModel === model.model_name ? (
                      <Input
                        type="number"
                        step="0.000001"
                        value={model.output_price_per_1k}
                        onChange={(e) =>
                          updateModelField(
                            model.model_name,
                            'output_price_per_1k',
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-32 ml-auto"
                      />
                    ) : (
                      formatPrice(model.output_price_per_1k)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editingModel === model.model_name ? (
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleSave(model.model_name)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingModel(null);
                            loadPricing();
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingModel(model.model_name)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(model.model_name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pricing?.default_pricing && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Default Pricing
            </CardTitle>
            <CardDescription>
              Used for models without specific pricing configuration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Input Price (per 1K tokens)</Label>
                <div className="text-2xl font-bold mt-2">
                  {formatPrice(pricing.default_pricing.input_price_per_1k)}
                </div>
              </div>
              <div>
                <Label>Output Price (per 1K tokens)</Label>
                <div className="text-2xl font-bold mt-2">
                  {formatPrice(pricing.default_pricing.output_price_per_1k)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Model Pricing</DialogTitle>
            <DialogDescription>
              Configure pricing for a new AI model
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="model_name">Model Name *</Label>
              <Input
                id="model_name"
                placeholder="e.g., gpt-4-turbo"
                value={formData.model_name || ''}
                onChange={(e) =>
                  setFormData({ ...formData, model_name: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="provider">Provider</Label>
              <Input
                id="provider"
                placeholder="e.g., OpenAI"
                value={formData.provider || ''}
                onChange={(e) =>
                  setFormData({ ...formData, provider: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                placeholder="e.g., openai"
                value={formData.category || ''}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="input_price">Input Price (per 1K tokens) *</Label>
              <Input
                id="input_price"
                type="number"
                step="0.000001"
                placeholder="0.001"
                value={formData.input_price_per_1k || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    input_price_per_1k: parseFloat(e.target.value),
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="output_price">Output Price (per 1K tokens) *</Label>
              <Input
                id="output_price"
                type="number"
                step="0.000001"
                placeholder="0.002"
                value={formData.output_price_per_1k || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    output_price_per_1k: parseFloat(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddModel}>Add Model</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
